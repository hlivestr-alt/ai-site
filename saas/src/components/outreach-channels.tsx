"use client";
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from './api';
import type { safeChannel } from '@/lib/outreach';
export function OutreachChannels({ workspaceId, initialChannels, testAvailable, canManage }: {
    workspaceId: string;
    initialChannels: ReturnType<typeof safeChannel>[];
    testAvailable: boolean;
    canManage: boolean;
}) {
    const router = useRouter(), [channels, setChannels] = useState(initialChannels), [provider, setProvider] = useState(testAvailable ? 'TEST' : 'TIKTOK_SHOP'), [label, setLabel] = useState(''), [error, setError] = useState(''), [pending, setPending] = useState(false), [choices, setChoices] = useState<Record<string, {
        choice: string;
        label: string;
        region: string;
    }[]>>({});
    async function connect(e: FormEvent) {
        e.preventDefault();
        setPending(true);
        setError('');
        try {
            const r = await api<{
                channel: ReturnType<typeof safeChannel>;
            }>(`/api/workspaces/${workspaceId}/outreach/channels`, 'POST', { provider, label });
            setChannels(c => [r.channel, ...c]);
            setLabel('');
            router.refresh();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'The account could not be added.');
        }
        finally {
            setPending(false);
        }
    }
    async function disconnect(id: string) {
        setPending(true);
        setError('');
        try {
            const r = await api<{
                channel: ReturnType<typeof safeChannel>;
            }>(`/api/workspaces/${workspaceId}/outreach/channels/${id}`, 'POST', { action: 'disconnect' });
            setChannels(c => c.map(v => v.id === id ? r.channel : v));
            router.refresh();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'The account could not be disconnected.');
        }
        finally {
            setPending(false);
        }
    }
    async function accountAction(id: string, action: string, choice?: string) { setPending(true); setError(''); try {
        const r = await api<{
            channel?: ReturnType<typeof safeChannel>;
            authorizationUrl?: string;
        }>(`/api/workspaces/${workspaceId}/outreach/channels/${id}/authorization`, 'POST', { action, ...(choice ? { choice } : {}) });
        if (r.authorizationUrl) {
            window.location.assign(r.authorizationUrl);
            return;
        }
        if (r.channel)
            setChannels(cs => cs.map(c => c.id === id ? r.channel! : c));
        router.refresh();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Account needs attention.');
    }
    finally {
        setPending(false);
    } }
    async function loadChoices(id: string) { try {
        const r = await api<{
            choices: {
                choice: string;
                label: string;
                region: string;
            }[];
        }>(`/api/workspaces/${workspaceId}/outreach/channels/${id}/authorization`);
        setChoices(cs => ({ ...cs, [id]: r.choices }));
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Reconnect this account.');
    } }
    return <><section className="panel"><h2>Your outbound accounts</h2><p className="notice">Each workspace owns its account authorization. Account activation requires an approved provider application. Real sending stays disabled until a separately approved controlled certification.</p>{channels.length ? <div className="outreach-channel-list">{channels.map(c => <div className="review-card" key={c.id}><strong>{c.label}</strong><p>{c.provider === 'TEST' ? 'TEST account · no external messages' : (c.simulation ? 'TEST provider fixture · no external messages' : 'TikTok Shop · workspace-owned account')}</p><span className="pill">{c.connectionNeedsReauth || c.status === 'NEEDS_REAUTH' ? 'Needs reauthorization' : c.status === 'CONNECTED' ? 'Connected' : ['DISCONNECTED', 'REVOKED'].includes(c.status) ? 'Disconnected' : c.status === 'NEEDS_ATTENTION' || c.status === 'ERROR' ? 'Needs attention' : 'Pending activation'}</span>{c.provider === 'TIKTOK_SHOP' && <><p className="muted">{c.realSendingEnabled ? 'Controlled canary only · separate operator approval required' : 'Real sending disabled · no bulk campaigns'}</p><p>{c.certification === 'CERTIFIED' ? 'Controlled canary certified' : c.certification === 'CANARY_READY' ? 'Canary prepared · awaiting operator approval' : 'Provider certification pending'}</p>{canManage && <div className="actions"><button type="button" className="button secondary" disabled={pending || !c.authorizationAvailable} onClick={() => void accountAction(c.id, 'authorize')}>{c.status === 'CONNECTED' || c.status === 'NEEDS_REAUTH' ? 'Reconnect account' : 'Connect account'}</button>{c.status === 'CONNECTED' && <><button type="button" className="text-button" disabled={pending} onClick={() => void accountAction(c.id, 'verify')}>Verify connection</button><button type="button" className="text-button" disabled={pending} onClick={() => void accountAction(c.id, 'refresh')}>Refresh authorization</button></>}{['CONNECTED', 'NEEDS_REAUTH', 'PENDING', 'NEEDS_ATTENTION'].includes(c.status) && <button type="button" className="text-button" disabled={pending} onClick={() => void accountAction(c.id, 'disconnect')}>Disconnect account</button>}{c.status === 'PENDING' && <button type="button" className="text-button" disabled={pending} onClick={() => void loadChoices(c.id)}>Choose authorized account</button>}</div>}{!c.authorizationAvailable && <p>Contact support · pending activation</p>}{choices[c.id]?.map(v => <button type="button" className="button secondary" disabled={pending} key={v.choice} onClick={() => void accountAction(c.id, 'select', v.choice)}>{v.label} · {v.region}</button>)}</>}{c.provider === 'TEST' && <p className="muted">Sending service: {c.sendingAvailable ? 'Available' : 'Unavailable'}</p>}{c.provider === 'TEST' && c.outboundCapable && canManage && <button type="button" className="text-button" disabled={pending} onClick={() => void disconnect(c.id)}>Disconnect</button>}</div>)}</div> : <p className="muted">No outbound accounts have been added to this workspace.</p>}</section>{canManage && <section className="panel"><h2>Add an outbound account</h2><form onSubmit={connect} className="outreach-grid"><label>Channel<select aria-label="Channel" value={provider} onChange={e => setProvider(e.target.value)}><option value="TIKTOK_SHOP">TikTok Shop · your authorized account</option>{testAvailable && <option value="TEST">TEST account · controlled QA only</option>}</select></label><label>Account label<input required maxLength={80} value={label} onChange={e => setLabel(e.target.value)}/></label><button className="button primary" disabled={pending}>{provider === 'TEST' ? 'Connect test account' : 'Record pending connection'}</button></form></section>}{error && <p className="notice error" role="alert">{error}</p>}</>;
}
