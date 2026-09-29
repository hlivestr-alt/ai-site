import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { confirmAndQueueCampaign, mapConfirmation, queueEnabled, validCampaignId, type ConfirmationSummary } from "./queue";
import { nativeAction, outreachApiUrl, validateDraft, type DraftInput } from "./write";

export type SendStage = "creating" | "selecting" | "freezing" | "queueing" | "sending" | "failed" | "uncertain";
export type SendOperation = {
  key: string; inputHash: string; stage: SendStage; campaignId?: string;
  frozen?: number; error?: string;
};
export type NativeSnapshot = { campaign: ConfirmationSummary; selected: number };
export type SendDependencies = {
  create(input: DraftInput): Promise<{ id: string }>;
  discover(id: string): Promise<unknown>;
  freeze(id: string, version: number): Promise<unknown>;
  snapshot(id: string): Promise<NativeSnapshot>;
  queue(id: string, version: number): Promise<unknown>;
  enabled(): boolean;
};
export type OperationStore = {
  read(key: string): Promise<SendOperation | null>;
  create(operation: SendOperation): Promise<boolean>;
  save(operation: SendOperation): Promise<void>;
};

const keyPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const activeStates = new Set(["QUEUED", "RUNNING", "PAUSE_REQUESTED", "PAUSED", "SAFETY_PAUSED", "COMPLETED", "COMPLETED_WITH_ERRORS"]);
const operationDirectory = () => resolve(process.cwd(), "data", "outreach-operations");
const operationPath = (key: string) => resolve(operationDirectory(), `${key}.json`);

export const fileOperations: OperationStore = {
  async read(key) {
    try { return JSON.parse(await readFile(operationPath(key), "utf8")) as SendOperation; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  },
  async create(operation) {
    await mkdir(operationDirectory(), { recursive: true });
    try { await writeFile(operationPath(operation.key), JSON.stringify(operation), { flag: "wx" }); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
  },
  async save(operation) {
    const temporary = resolve(operationDirectory(), `${operation.key}.${process.pid}.tmp`);
    await writeFile(temporary, JSON.stringify(operation));
    await rename(temporary, operationPath(operation.key));
  },
};

export const nativeSendDependencies: SendDependencies = {
  async create(input) {
    const result = await nativeAction("/api/v1/outreach/campaigns", input);
    if (typeof result.id !== "string" || !validCampaignId(result.id)) throw new Error("Outreach did not return a campaign ID.");
    return { id: result.id };
  },
  discover: id => nativeAction(`/api/v1/outreach/campaigns/${id}/discovery-runs`, {}),
  freeze: (id, version) => nativeAction(`/api/v1/outreach/campaigns/${id}/freeze`, { version }),
  async snapshot(id) {
    const response = await fetch(`${outreachApiUrl()}/api/v1/outreach/campaigns/${id}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("Campaign status is unavailable.");
    const data = await response.json() as Record<string, unknown>;
    const campaign = mapConfirmation(data);
    if (campaign.id !== id) throw new Error("Campaign identity changed.");
    const summary = data.summary && typeof data.summary === "object" ? data.summary as Record<string, unknown> : {};
    const selected = Number(summary.selected ?? 0);
    if (!Number.isSafeInteger(selected) || selected < 0) throw new Error("Recipient preview is invalid.");
    return { campaign, selected };
  },
  queue: (id, version) => confirmAndQueueCampaign(id, version),
  enabled: queueEnabled,
};

const locks = new Map<string, Promise<SendOperation>>();
export function sendCampaign(
  key: string, rawInput?: unknown, retry = false,
  dependencies: SendDependencies = nativeSendDependencies, store: OperationStore = fileOperations,
): Promise<SendOperation> {
  if (!keyPattern.test(key)) throw new Error("Invalid send operation.");
  const existing = locks.get(key);
  if (existing) return existing;
  const action = sendCampaignOnce(key, rawInput, retry, dependencies, store);
  locks.set(key, action);
  void action.finally(() => { if (locks.get(key) === action) locks.delete(key); }).catch(() => undefined);
  return action;
}

async function sendCampaignOnce(key: string, rawInput: unknown, retry: boolean, deps: SendDependencies, store: OperationStore): Promise<SendOperation> {
  let operation = await store.read(key);
  const input = rawInput === undefined ? undefined : validateDraft(rawInput);
  const inputHash = input ? createHash("sha256").update(JSON.stringify(input)).digest("hex") : undefined;
  if (operation && inputHash && operation.inputHash !== inputHash) throw new Error("This send operation belongs to different campaign details.");
  if (!operation) {
    if (!input || !inputHash) throw new Error("Campaign details are missing. Fill the form and try again.");
    if (!deps.enabled()) throw new Error("Campaign sending is currently unavailable.");
    operation = { key, inputHash, stage: "creating" };
    if (!await store.create(operation)) return sendCampaignOnce(key, rawInput, retry, deps, store);
    try {
      const result = await deps.create(input);
      operation = { ...operation, campaignId: result.id, stage: "selecting" };
      await store.save(operation);
      return operation;
    } catch {
      // Native create has no idempotency key. An uncertain response must never trigger another create.
      operation = { ...operation, stage: "uncertain", error: "Campaign creation could not be confirmed. Check Outreach before starting another campaign." };
      await store.save(operation);
      return operation;
    }
  }
  if (operation.stage === "uncertain" || operation.stage === "sending") return operation;
  if (operation.stage === "failed" && !retry) return operation;
  if (!operation.campaignId || !validCampaignId(operation.campaignId)) return { ...operation, stage: "uncertain", error: "Campaign creation could not be confirmed. Check Outreach." };
  const id = operation.campaignId;
  if (!deps.enabled()) return fail("Campaign sending is currently unavailable.");
  try {
    let { campaign, selected } = await deps.snapshot(id);
    if (activeStates.has(campaign.state)) return persist({ ...operation, stage: "sending", frozen: campaign.frozen, error: undefined });
    if (campaign.state === "DRAFT" || campaign.state === "PREVIEW_EXPIRED") {
      await persist({ ...operation, stage: "selecting", error: undefined });
      await deps.discover(id);
      ({ campaign, selected } = await deps.snapshot(id));
      if (campaign.state === "DISCOVERING") return operation;
      if (campaign.state === "PREVIEW_READY") {
        if (selected === 0) return fail("No eligible creators matched this campaign.");
        return persist({ ...operation, stage: "freezing", error: undefined });
      }
    }
    if (campaign.state === "DISCOVERING") return persist({ ...operation, stage: "selecting", error: undefined });
    if (campaign.state === "PREVIEW_READY") {
      if (selected === 0) return fail("No eligible creators matched this campaign.");
      await persist({ ...operation, stage: "freezing", error: undefined });
      await deps.freeze(id, campaign.version);
      ({ campaign } = await deps.snapshot(id));
      if (campaign.state === "PREVIEW_EXPIRED" || campaign.frozen === 0) return fail("No eligible creators matched this campaign.");
      if (campaign.state !== "FROZEN") return fail("Recipients could not be prepared. Check the campaign in Outreach.");
      return persist({ ...operation, stage: "queueing", frozen: campaign.frozen, error: undefined });
    }
    if (campaign.state === "FROZEN") {
      if (campaign.frozen === 0) return fail("No eligible creators matched this campaign.");
      if (!campaign.senderAvailable) return fail("The native Outreach sender is unavailable.");
      await persist({ ...operation, stage: "queueing", frozen: campaign.frozen, error: undefined });
      await deps.queue(id, campaign.version);
      const latest = await deps.snapshot(id);
      if (!activeStates.has(latest.campaign.state)) return fail("Outreach did not confirm sending. Check the campaign before retrying.");
      return persist({ ...operation, stage: "sending", frozen: latest.campaign.frozen, error: undefined });
    }
    return fail("Campaign is not ready to send. Check its status in Outreach.");
  } catch (error) {
    // A lost /send response may still mean success. Check native state before showing a retry.
    try {
      const latest = await deps.snapshot(id);
      if (activeStates.has(latest.campaign.state)) return persist({ ...operation, stage: "sending", frozen: latest.campaign.frozen, error: undefined });
    } catch { /* retain the original failure */ }
    return fail(error instanceof Error ? error.message : "Campaign could not be sent.");
  }

  async function persist(next: SendOperation) { await store.save(next); operation = next; return next; }
  async function fail(message: string) { return persist({ ...operation!, stage: "failed", error: message }); }
}
