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
}) { const router = useRouter(), [channels, setChannels] = useState(initialChannels), [provider, setProvider] = useState(testAvailable ? 'TEST' : 'TIKTOK_SHOP'), [label, setLabel] = useState(''), [error, setError] = useState(''), [pending, setPending] = useState(false); async function connect(e: FormEvent) { e.preventDefault(); setPending(true); setError(''); try {
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
} } async function disconnect(id: string) { setPending(true); setError(''); try {
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
} } return <><section className="panel"><h2>Your outbound accounts</h2><p className="notice">Real outbound connections are not available yet. Each workspace must connect its own authorized account before real sending is enabled.</p>{channels.length ? <div className="outreach-channel-list">{channels.map(c => <div className="review-card" key={c.id}><strong>{c.label}</strong><p>{c.provider === 'TEST' ? 'TEST account · no external messages' : 'TikTok Shop'}</p><span className="pill">{c.status === 'CONNECTED' ? 'Connected' : c.status === 'DISCONNECTED' ? 'Disconnected' : c.status === 'NEEDS_ATTENTION' ? 'Needs attention' : 'Unavailable'}</span>{c.provider === 'TEST' && <p className="muted">Sending service: {c.sendingAvailable ? 'Available' : 'Unavailable'}</p>}{c.provider === 'TEST' && c.outboundCapable && canManage && <button type="button" className="text-button" disabled={pending} onClick={() => void disconnect(c.id)}>Disconnect</button>}</div>)}</div> : <p className="muted">No outbound accounts have been added to this workspace.</p>}</section>{canManage && <section className="panel"><h2>Add an outbound account</h2><form onSubmit={connect} className="outreach-grid"><label>Channel<select aria-label="Channel" value={provider} onChange={e => setProvider(e.target.value)}><option value="TIKTOK_SHOP">TikTok Shop · connection pending</option>{testAvailable && <option value="TEST">TEST account · controlled QA only</option>}</select></label><label>Account label<input required maxLength={80} value={label} onChange={e => setLabel(e.target.value)}/></label><button className="button primary" disabled={pending}>{provider === 'TEST' ? 'Connect test account' : 'Record pending connection'}</button></form></section>}{error && <p className="notice error" role="alert">{error}</p>}</>; }
