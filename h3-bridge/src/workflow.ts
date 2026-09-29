import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomInt } from "node:crypto";
import { frameCount, RESOLUTION, resolutionFor, type JobRequest } from "./contract.js";

type Node = { class_type: string; inputs: Record<string, unknown> };
export type Workflow = Record<string, Node>;
const templateFile = join(process.cwd(), "workflows", "bridge-ref2va.json");
const templateSha256 = "e4d20993f4dd33d121a67050c1ebe05f85d7a1c776176c1fbe3cfc981094b465";

function assertNode(graph: Workflow, id: string, kind: string) {
  if (graph[id]?.class_type !== kind || !graph[id].inputs) throw new Error(`Bridge workflow node ${id} is invalid`);
}
function isLink(value: unknown): value is [string, number] { return Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "number"; }
export function validateWorkflow(graph: Workflow, referenceCount: number, expected?: { frames: number; jobId: string; megapixels?: number }) {
  for (const [id, kind] of Object.entries({ "92": "SaveVideo", "115": "ResolutionSelector", "124": "BasicScheduler", "129": "RandomNoise", "130": "CreateVideo", "131": "ComfyMathExpression", "136": "MiniMaxH3ReferenceToVideo", "137": "LoadImage", "138": "PrimitiveStringMultiline", "143": "PrimitiveInt", "146": "PrimitiveBoolean" })) assertNode(graph, id, kind);
  if (Object.values(graph).filter(n => n.class_type === "SaveVideo").length !== 1) throw new Error("Workflow must have exactly one video output");
  if (Object.values(graph).some(n => /PromptEnhancer|PromptValidator|PromptValidityGate|Unload|Archive/.test(n.class_type))) throw new Error("Workflow contains a forbidden prompt-engine or model-control node");
  if (JSON.stringify(graph).includes("{{H3_")) throw new Error("Workflow has unresolved inputs");
  if (JSON.stringify(graph["136"].inputs.prompt) !== JSON.stringify(["138", 0])) throw new Error("H3 prompt must use direct input 138");
  if (JSON.stringify(graph["92"].inputs.video) !== JSON.stringify(["130", 0])) throw new Error("SaveVideo output link changed");
  if (JSON.stringify(graph["136"].inputs["ref_images.ref_image_0"]) !== JSON.stringify(["137", 0])) throw new Error("First reference link changed");
  if (referenceCount === 2 && JSON.stringify(graph["136"].inputs["ref_images.ref_image_1"]) !== JSON.stringify(["139", 0])) throw new Error("Second reference link changed");
  if (graph["115"].inputs.aspect_ratio !== "9:16 (Portrait Widescreen)" || graph["115"].inputs.megapixels !== (expected?.megapixels ?? RESOLUTION.megapixels) || graph["115"].inputs.multiple !== 32) throw new Error("Resolution contract changed");
  if (expected && graph["131"].inputs.expression !== `${expected.frames} + 0`) throw new Error("Duration frame contract changed");
  if (expected && graph["92"].inputs.filename_prefix !== `ai_site/${expected.jobId}/video`) throw new Error("Output namespace changed");
  if (graph["146"].inputs.value !== false) throw new Error("Lightning branch must remain disabled");
  if (referenceCount === 2) assertNode(graph, "139", "LoadImage");
  for (const [id, node] of Object.entries(graph)) {
    const scan = (value: unknown) => {
      if (isLink(value)) { if (!graph[value[0]]) throw new Error(`Workflow node ${id} has missing link`); return; }
      if (value && typeof value === "object") for (const item of Object.values(value)) scan(item);
    };
    scan(node.inputs);
  }
  if (Object.keys(graph["136"].inputs).filter(key => key.startsWith("ref_images.ref_image_")).length !== referenceCount) throw new Error("Reference slot count differs from request");
  return graph;
}

export async function buildWorkflow(request: JobRequest, id: string, filenames: string[]): Promise<Workflow> {
  if (filenames.length < 1 || filenames.length > 2 || filenames.some((name, index) => !new RegExp(`^reference-${index + 1}(?: \\(\\d+\\))?\\.(png|jpg|webp)$`).test(name))) throw new Error("Reference upload name is invalid");
  const source = await readFile(templateFile);
  if (createHash("sha256").update(source).digest("hex") !== templateSha256) throw new Error("Bridge workflow template does not match the reviewed contract");
  const graph = JSON.parse(source.toString("utf8")) as Workflow;
  const frames = frameCount(request.duration_seconds);
  const resolution = resolutionFor(request.resolution ?? "576x1024");
  graph["138"].inputs.value = request.prompt.trim();
  graph["115"].inputs.aspect_ratio = "9:16 (Portrait Widescreen)";
  graph["115"].inputs.megapixels = resolution.megapixels;
  graph["115"].inputs.multiple = 32;
  graph["131"].inputs.expression = `${frames} + 0`;
  graph["130"].inputs.fps = RESOLUTION.fps;
  graph["129"].inputs.noise_seed = randomInt(0, 2 ** 31);
  graph["124"].inputs.scheduler = "simple";
  graph["143"].inputs.value = 20;
  graph["136"].inputs.ref_image_size = "max";
  graph["137"].inputs.image = `ai_site/${id}/${filenames[0]}`;
  if (filenames.length === 2) graph["139"].inputs.image = `ai_site/${id}/${filenames[1]}`;
  else { delete graph["136"].inputs["ref_images.ref_image_1"]; delete graph["139"]; }
  graph["92"].inputs.filename_prefix = `ai_site/${id}/video`;
  return validateWorkflow(graph, filenames.length, { frames, jobId: id, megapixels: resolution.megapixels });
}
