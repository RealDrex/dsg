import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { formatMoney, type CurrencyCode } from '@bestprice/core';
import { ApiError, del, get, login, logout, patch, post, restore, setLogoutHandler } from './api';

type Page = 'dashboard' | 'products' | 'stores' | 'sources' | 'quality' | 'sponsored' | 'users' | 'audit';
const PAGES: [Page, string][] = [
  ['dashboard', 'Overview'], ['products', 'Products'], ['stores', 'Stores & branches'], ['sources', 'Data sources'],
  ['quality', 'Data quality'], ['sponsored', 'Sponsored'], ['users', 'Users'], ['audit', 'Audit log'],
];

const money = (m: number | null | undefined, c = 'SAR') => (m == null ? '—' : formatMoney(m, c as CurrencyCode, 'en'));
const errMsg = (e: unknown) => (e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString() : '—');

function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => { fn().then((d) => { setData(d); setError(null); }).catch((e) => setError(errMsg(e))); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(reload, [reload]);
  return { data, error, reload };
}

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [page, setPage] = useState<Page>('dashboard');
  useEffect(() => {
    setLogoutHandler(() => setAuthed(false));
    restore().then(setAuthed);
  }, []);
  if (authed === null) return null;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  return (
    <div className="layout">
      <aside className="side">
        <div className="brand">Best<b>Price</b> <span className="muted" style={{ fontSize: 12 }}>admin</span></div>
        {PAGES.map(([k, l]) => <button key={k} className={`nav ${page === k ? 'on' : ''}`} onClick={() => setPage(k)}>{l}</button>)}
        <div className="spacer" />
        <button onClick={async () => { await logout(); setAuthed(false); }}>Sign out</button>
      </aside>
      <main className="main">
        {page === 'dashboard' && <Dashboard go={setPage} />}
        {page === 'products' && <Products />}
        {page === 'stores' && <Stores />}
        {page === 'sources' && <Sources />}
        {page === 'quality' && <Quality />}
        {page === 'sponsored' && <Sponsored />}
        {page === 'users' && <Users />}
        {page === 'audit' && <Audit />}
      </main>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="login card" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(null); try { await login(email, password); onDone(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); } }}>
      <div className="brand">Best<b>Price</b> admin</div>
      <label>Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      {err && <div className="err">{err}</div>}
      <button className="primary" disabled={busy}>Sign in</button>
      <div className="muted" style={{ fontSize: 12 }}>Accounts are locked for 15 minutes after 5 failed attempts.</div>
    </form>
  );
}

function Header({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="row" style={{ alignItems: 'flex-start', marginBottom: 6 }}>
      <div><h1>{title}</h1>{sub && <p className="sub">{sub}</p>}</div>
      <div className="spacer" />{children}
    </div>
  );
}

/* ------------------------------- Overview ------------------------------- */

interface Stats {
  products: number; productsWithFreshPrices: number; priceCoverage: number; offers: number; flaggedOffers: number; staleOffers: number;
  unmatchedListings: number; activeSources: number; members: number; guests: number; watches: number; clicks7d: number; assistantMessagesToday: number; assistantMode: string;
}
function Dashboard({ go }: { go: (p: Page) => void }) {
  const { data: s, error } = useLoad(() => get<Stats>('/v1/admin/stats'));
  if (error) return <div className="err">{error}</div>;
  if (!s) return null;
  const k = (n: number | string, l: string, tone = '', onClick?: () => void) => (
    <div className={`card kpi ${tone}`} onClick={onClick} style={{ cursor: onClick ? 'pointer' : undefined }}><div className="n">{n}</div><div className="l">{l}</div></div>
  );
  return (
    <>
      <Header title="Overview" sub="Data quality first: success is measured by trustworthy results, not feature count." />
      <h2>Catalog & price quality</h2>
      <div className="grid">
        {k(`${Math.round(s.priceCoverage * 100)}%`, `Products with fresh prices (${s.productsWithFreshPrices}/${s.products})`, s.priceCoverage > 0.8 ? 'good' : 'warn')}
        {k(s.offers, 'Active offers')}
        {k(s.flaggedOffers, 'Flagged offers (hidden)', s.flaggedOffers ? 'bad' : 'good', () => go('quality'))}
        {k(s.staleOffers, 'Stale offers (>7 days)', s.staleOffers ? 'warn' : 'good', () => go('quality'))}
        {k(s.unmatchedListings, 'Unmatched listings to review', s.unmatchedListings ? 'warn' : 'good', () => go('quality'))}
        {k(s.activeSources, 'Active data sources', '', () => go('sources'))}
      </div>
      <h2>Usage</h2>
      <div className="grid">
        {k(s.members, 'Members')}{k(s.guests, 'Guest sessions')}{k(s.watches, 'Price watches')}{k(s.clicks7d, 'Store click-outs (7d)')}
        {k(s.assistantMessagesToday, 'Assistant messages today')}{k(s.assistantMode === 'ai' ? 'AI' : 'Rules', 'Assistant mode', s.assistantMode === 'ai' ? 'good' : 'warn')}
      </div>
    </>
  );
}

/* ------------------------------- Products ------------------------------- */

interface ProductRow { id: string; name: string; nameAr: string | null; brand: string | null; model: string | null; category: string; status: string; offerCount: number; specs: unknown[]; attributes: Record<string, unknown>; specSourceLabel: string | null; specSourceUrl: string | null; description: string | null; imageUrl: string | null }
function Products() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, reload } = useLoad(() => get<{ items: ProductRow[]; total: number; pageSize: number }>(`/v1/admin/products?page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}`), [q, page]);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  return (
    <>
      <Header title="Products" sub="Canonical catalog. Barcodes (GTINs) are validated and must be unique to one product.">
        <button className="primary" onClick={() => setEditing('new')}>New product</button>
      </Header>
      {editing && <ProductForm id={editing} onClose={() => { setEditing(null); reload(); }} />}
      <div className="row" style={{ margin: '10px 0' }}><input placeholder="Search name or brand" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} style={{ maxWidth: 320 }} /></div>
      {error && <div className="err">{error}</div>}
      <table>
        <thead><tr><th>Name</th><th>Brand / model</th><th>Category</th><th>Offers</th><th>Status</th><th /></tr></thead>
        <tbody>
          {data?.items.map((p) => (
            <tr key={p.id}>
              <td>{p.name}{p.nameAr && <div className="muted">{p.nameAr}</div>}</td>
              <td>{p.brand} <span className="mono muted">{p.model}</span></td>
              <td>{p.category}</td>
              <td>{p.offerCount}</td>
              <td><span className={`pill ${p.status === 'active' ? 'green' : ''}`}>{p.status}</span></td>
              <td><button onClick={() => setEditing(p.id)}>Edit</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {data && data.total > data.pageSize && (
        <div className="row" style={{ marginTop: 10 }}>
          <button disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="muted">Page {page} of {Math.ceil(data.total / data.pageSize)}</span>
          <button disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </>
  );
}

function ProductForm({ id, onClose }: { id: string; onClose: () => void }) {
  const isNew = id === 'new';
  const [f, setF] = useState({ name: '', nameAr: '', brand: '', model: '', category: 'laptop', status: 'active', gtins: '', specs: '[]', attributes: '{}', specSourceLabel: '', specSourceUrl: '', description: '' });
  const [offers, setOffers] = useState<{ id: string; storeName: string; sourceName: string; priceMinor: number; currency: string; flagged: boolean; active: boolean; observedAt: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (isNew) return;
    get<ProductRow & { gtins: string[]; offers: typeof offers }>(`/v1/admin/products/${id}`).then((p) => {
      setF({ name: p.name, nameAr: p.nameAr ?? '', brand: p.brand ?? '', model: p.model ?? '', category: p.category, status: p.status, gtins: p.gtins.join(', '), specs: JSON.stringify(p.specs, null, 2), attributes: JSON.stringify(p.attributes, null, 2), specSourceLabel: p.specSourceLabel ?? '', specSourceUrl: p.specSourceUrl ?? '', description: p.description ?? '' });
      setOffers(p.offers);
    }).catch((e) => setErr(errMsg(e)));
  }, [id, isNew]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setErr(null);
    let specs, attributes;
    try { specs = JSON.parse(f.specs); attributes = JSON.parse(f.attributes); } catch { return setErr('Specs and attributes must be valid JSON'); }
    const body = {
      name: f.name, nameAr: f.nameAr || null, brand: f.brand || null, model: f.model || null, category: f.category, status: f.status,
      gtins: f.gtins.split(/[\s,]+/).filter(Boolean), specs, attributes,
      specSourceLabel: f.specSourceLabel || null, specSourceUrl: f.specSourceUrl || null, description: f.description || null,
    };
    try { if (isNew) await post('/v1/admin/products', body); else await patch(`/v1/admin/products/${id}`, body); onClose(); } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <div className="card" style={{ margin: '12px 0' }}>
      <h2 style={{ marginTop: 0 }}>{isNew ? 'New product' : 'Edit product'}</h2>
      <div className="form">
        <label>Name (EN)<input value={f.name} onChange={set('name')} /></label>
        <label>Name (AR)<input value={f.nameAr} onChange={set('nameAr')} dir="rtl" /></label>
        <label>Brand<input value={f.brand} onChange={set('brand')} /></label>
        <label>Model<input value={f.model} onChange={set('model')} /></label>
        <label>Category<select value={f.category} onChange={set('category')}>{['laptop', 'phone', 'headphones', 'tablet', 'coffee', 'home', 'fragrance', 'fashion', 'furniture', 'gaming', 'beauty'].map((c) => <option key={c}>{c}</option>)}</select></label>
        <label>Status<select value={f.status} onChange={set('status')}><option>active</option><option>hidden</option></select></label>
        <label className="full">Barcodes (GTIN/EAN/UPC, comma separated)<input value={f.gtins} onChange={set('gtins')} className="mono" /></label>
        <label>Specs (JSON: key, label, labelAr, value)<textarea value={f.specs} onChange={set('specs')} /></label>
        <label>Attributes for recommendations (JSON)<textarea value={f.attributes} onChange={set('attributes')} /></label>
        <label>Spec source<input value={f.specSourceLabel} onChange={set('specSourceLabel')} placeholder="e.g. Manufacturer product page" /></label>
        <label>Spec source URL (https)<input value={f.specSourceUrl} onChange={set('specSourceUrl')} /></label>
        <label className="full">Description<textarea value={f.description} onChange={set('description')} style={{ minHeight: 60 }} /></label>
      </div>
      {err && <div className="err">{err}</div>}
      <div className="row" style={{ marginTop: 12 }}><button className="primary" onClick={save}>Save</button><button onClick={onClose}>Cancel</button></div>
      {offers.length > 0 && (
        <>
          <h2>Offers</h2>
          <table><thead><tr><th>Store</th><th>Source</th><th>Price</th><th>Observed</th><th>State</th></tr></thead>
            <tbody>{offers.map((o) => <tr key={o.id}><td>{o.storeName}</td><td>{o.sourceName}</td><td>{money(o.priceMinor, o.currency)}</td><td>{when(o.observedAt)}</td><td>{o.flagged ? <span className="pill red">flagged</span> : o.active ? <span className="pill green">live</span> : <span className="pill">inactive</span>}</td></tr>)}</tbody>
          </table>
        </>
      )}
    </div>
  );
}

/* -------------------------------- Stores -------------------------------- */

interface Store { id: string; slug: string; name: string; nameAr: string; brandColor: string | null; website: string | null; allowedDomains: string[]; active: boolean; branches: { id: string; name: string; nameAr: string; city: string; lat: number; lng: number }[] }
function Stores() {
  const { data, error, reload } = useLoad(() => get<Store[]>('/v1/admin/stores'));
  const [f, setF] = useState({ slug: '', name: '', nameAr: '', website: '', allowedDomains: '', brandColor: '#3EE09A' });
  const [b, setB] = useState<Record<string, { name: string; nameAr: string; city: string; lat: string; lng: string }>>({});
  const [err, setErr] = useState<string | null>(null);
  const create = async () => {
    setErr(null);
    try {
      await post('/v1/admin/stores', { ...f, website: f.website || null, allowedDomains: f.allowedDomains.split(/[\s,]+/).filter(Boolean) });
      setF({ slug: '', name: '', nameAr: '', website: '', allowedDomains: '', brandColor: '#3EE09A' });
      reload();
    } catch (e) { setErr(errMsg(e)); }
  };
  const addBranch = async (s: Store) => {
    const x = b[s.id];
    if (!x) return;
    try { await post(`/v1/admin/stores/${s.id}/branches`, { ...x, lat: Number(x.lat), lng: Number(x.lng) }); setB({ ...b, [s.id]: { name: '', nameAr: '', city: '', lat: '', lng: '' } }); reload(); } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <>
      <Header title="Stores & branches" sub="Outbound links only open on a store's allow-listed domains. Branch coordinates power the 'nearest' ranking." />
      {(error || err) && <div className="err">{error || err}</div>}
      <div className="card">
        <div className="form">
          <label>Slug<input value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} placeholder="jarir" /></label>
          <label>Brand colour<input value={f.brandColor} onChange={(e) => setF({ ...f, brandColor: e.target.value })} /></label>
          <label>Name (EN)<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>Name (AR)<input dir="rtl" value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} /></label>
          <label>Website (https)<input value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></label>
          <label>Allowed link domains<input value={f.allowedDomains} onChange={(e) => setF({ ...f, allowedDomains: e.target.value })} placeholder="jarir.com" /></label>
        </div>
        <div className="row" style={{ marginTop: 12 }}><button className="primary" onClick={create}>Add store</button></div>
      </div>
      {data?.map((s) => (
        <div className="card" key={s.id} style={{ marginTop: 12 }}>
          <div className="row">
            <span style={{ width: 14, height: 14, borderRadius: 4, background: s.brandColor ?? '#333', display: 'inline-block' }} />
            <b>{s.name}</b><span className="muted">{s.nameAr}</span><span className="mono muted">{s.allowedDomains.join(', ')}</span>
            <div className="spacer" />
            <button onClick={async () => { await patch(`/v1/admin/stores/${s.id}`, { active: !s.active }).catch((e) => setErr(errMsg(e))); reload(); }}>{s.active ? 'Deactivate' : 'Activate'}</button>
          </div>
          <table style={{ marginTop: 10 }}>
            <thead><tr><th>Branch</th><th>City</th><th>Coordinates</th><th /></tr></thead>
            <tbody>
              {s.branches.map((br) => <tr key={br.id}><td>{br.name} <span className="muted">{br.nameAr}</span></td><td>{br.city}</td><td className="mono">{br.lat.toFixed(4)}, {br.lng.toFixed(4)}</td><td><button className="danger" onClick={async () => { await del(`/v1/admin/branches/${br.id}`); reload(); }}>Remove</button></td></tr>)}
              <tr>
                <td><div className="row"><input placeholder="Name" value={b[s.id]?.name ?? ''} onChange={(e) => setB({ ...b, [s.id]: { ...(b[s.id] ?? { name: '', nameAr: '', city: '', lat: '', lng: '' }), name: e.target.value } })} /><input dir="rtl" placeholder="الاسم" value={b[s.id]?.nameAr ?? ''} onChange={(e) => setB({ ...b, [s.id]: { ...(b[s.id] ?? { name: '', nameAr: '', city: '', lat: '', lng: '' }), nameAr: e.target.value } })} /></div></td>
                <td><input placeholder="City" value={b[s.id]?.city ?? ''} onChange={(e) => setB({ ...b, [s.id]: { ...(b[s.id] ?? { name: '', nameAr: '', city: '', lat: '', lng: '' }), city: e.target.value } })} /></td>
                <td><div className="row"><input placeholder="lat" value={b[s.id]?.lat ?? ''} onChange={(e) => setB({ ...b, [s.id]: { ...(b[s.id] ?? { name: '', nameAr: '', city: '', lat: '', lng: '' }), lat: e.target.value } })} /><input placeholder="lng" value={b[s.id]?.lng ?? ''} onChange={(e) => setB({ ...b, [s.id]: { ...(b[s.id] ?? { name: '', nameAr: '', city: '', lat: '', lng: '' }), lng: e.target.value } })} /></div></td>
                <td><button onClick={() => addBranch(s)}>Add branch</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

/* ----------------------------- Data sources ----------------------------- */

interface Source { id: string; name: string; type: string; storeId: string | null; country: string; active: boolean; termsNote: string; feedUrl: string | null; lastRunAt: string | null; lastStatus: string | null }
function Sources() {
  const { data, error, reload } = useLoad(() => get<Source[]>('/v1/admin/sources'));
  const { data: stores } = useLoad(() => get<Store[]>('/v1/admin/stores'));
  const [f, setF] = useState({ name: '', type: 'affiliate_feed', storeId: '', termsNote: '', feedUrl: '' });
  const [importing, setImporting] = useState<string | null>(null);
  const [payload, setPayload] = useState('');
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const run = async (fn: () => Promise<unknown>, ok?: (r: unknown) => string) => {
    setMsg({});
    try { const r = await fn(); setMsg({ ok: ok ? ok(r) : 'Saved' }); reload(); } catch (e) { setMsg({ err: errMsg(e) }); }
  };
  const report = (r: unknown) => { const x = r as { received: number; created: number; updated: number; flagged: number; unmatched: number; rejected: unknown[] }; return `Received ${x.received}: ${x.created} new, ${x.updated} updated, ${x.flagged} flagged, ${x.unmatched} unmatched, ${x.rejected.length} rejected`; };
  return (
    <>
      <Header title="Data sources" sub="Only legal, permitted sources: official store APIs, partner catalogs, affiliate feeds, verified user reports. A source cannot go live without a documented legal basis." />
      {error && <div className="err">{error}</div>}
      {msg.err && <div className="err">{msg.err}</div>}{msg.ok && <div className="ok">{msg.ok}</div>}
      <div className="card">
        <div className="form">
          <label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>Type<select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="official_api">Official store API</option><option value="partner_catalog">Partner catalog</option><option value="affiliate_feed">Affiliate feed</option><option value="user_report">Verified user reports</option></select></label>
          <label>Store<select value={f.storeId} onChange={(e) => setF({ ...f, storeId: e.target.value })}><option value="">—</option>{stores?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label>Feed URL (https, optional)<input value={f.feedUrl} onChange={(e) => setF({ ...f, feedUrl: e.target.value })} /></label>
          <label className="full">Legal basis (API terms, partner agreement, affiliate program ID)<input value={f.termsNote} onChange={(e) => setF({ ...f, termsNote: e.target.value })} /></label>
        </div>
        <div className="row" style={{ marginTop: 12 }}><button className="primary" onClick={() => run(() => post('/v1/admin/sources', { ...f, storeId: f.storeId || null, feedUrl: f.feedUrl || null, active: false }))}>Add source (inactive)</button></div>
      </div>
      <table style={{ marginTop: 14 }}>
        <thead><tr><th>Source</th><th>Type</th><th>Legal basis</th><th>Last run</th><th>State</th><th /></tr></thead>
        <tbody>
          {data?.map((s) => (
            <tr key={s.id}>
              <td>{s.name}<div className="mono muted">{s.feedUrl}</div></td>
              <td><span className={`pill ${s.type === 'demo' ? 'warn' : ''}`}>{s.type}</span></td>
              <td className="muted" style={{ maxWidth: 260 }}>{s.termsNote || <span className="pill red">missing</span>}</td>
              <td>{when(s.lastRunAt)}<div className="muted">{s.lastStatus}</div></td>
              <td>{s.active ? <span className="pill green">active</span> : <span className="pill">inactive</span>}</td>
              <td><div className="row">
                <button onClick={() => run(() => patch(`/v1/admin/sources/${s.id}`, { active: !s.active }))}>{s.active ? 'Pause' : 'Activate'}</button>
                <button onClick={() => { setImporting(s.id); setPayload(''); }}>Import</button>
                {s.feedUrl && <button onClick={() => run(() => post(`/v1/admin/sources/${s.id}/fetch`), report)}>Fetch now</button>}
              </div></td>
            </tr>
          ))}
        </tbody>
      </table>
      {importing && (
        <div className="card" style={{ marginTop: 14 }}>
          <h2 style={{ marginTop: 0 }}>Import listings</h2>
          <p className="muted">JSON array of listings: externalId, title, gtin?, brand?, model?, priceMinor, shippingMinor?, currency, channel (local|online), stock, warrantyMonths?, returnDays?, etaHours?, url?, observedAt?. Listings are matched by barcode, then brand+model; anything else goes to review. Outlier prices are flagged and hidden until approved.</p>
          <textarea value={payload} onChange={(e) => setPayload(e.target.value)} placeholder='[{"externalId":"sku-1","title":"…","gtin":"…","priceMinor":279900,"currency":"SAR","channel":"online","stock":"in_stock","url":"https://…"}]' />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="primary" onClick={() => run(async () => { let listings; try { listings = JSON.parse(payload); } catch { throw new Error('Invalid JSON'); } return post(`/v1/admin/sources/${importing}/import`, { listings }); }, report)}>Import</button>
            <button onClick={() => setImporting(null)}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}

/* ----------------------------- Data quality ----------------------------- */

function Quality() {
  const flagged = useLoad(() => get<{ id: string; productName: string; storeName: string; priceMinor: number; currency: string; flagReason: string; observedAt: string }[]>('/v1/admin/offers/flagged'));
  const unmatched = useLoad(() => get<{ id: string; title: string; payload: { gtin?: string; brand?: string; model?: string; priceMinor: number; currency: string }; createdAt: string }[]>('/v1/admin/unmatched'));
  const [pick, setPick] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, ProductRow[]>>({});
  const [err, setErr] = useState<string | null>(null);
  const find = async (id: string, q: string) => {
    setPick({ ...pick, [id]: q });
    if (q.length < 2) return;
    const r = await get<{ items: ProductRow[] }>(`/v1/admin/products?q=${encodeURIComponent(q)}`).catch(() => ({ items: [] }));
    setResults({ ...results, [id]: r.items.slice(0, 5) });
  };
  return (
    <>
      <Header title="Data quality" sub="Contradictory or anomalous prices never reach users until a human reviews them. We never guess that two products are the same." />
      {err && <div className="err">{err}</div>}
      <h2>Flagged offers</h2>
      <table>
        <thead><tr><th>Product</th><th>Store</th><th>Price</th><th>Reason</th><th>Observed</th><th /></tr></thead>
        <tbody>
          {flagged.data?.length === 0 && <tr><td colSpan={6} className="muted">Nothing flagged.</td></tr>}
          {flagged.data?.map((o) => (
            <tr key={o.id}>
              <td>{o.productName}</td><td>{o.storeName}</td><td>{money(o.priceMinor, o.currency)}</td><td><span className="pill red">{o.flagReason}</span></td><td>{when(o.observedAt)}</td>
              <td><div className="row">
                <button onClick={async () => { await post(`/v1/admin/offers/${o.id}/approve`).catch((e) => setErr(errMsg(e))); flagged.reload(); }}>Approve</button>
                <button className="danger" onClick={async () => { await post(`/v1/admin/offers/${o.id}/deactivate`).catch((e) => setErr(errMsg(e))); flagged.reload(); }}>Reject</button>
              </div></td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Unmatched listings</h2>
      <table>
        <thead><tr><th>Listing</th><th>Identifiers</th><th>Price</th><th>Match to product</th></tr></thead>
        <tbody>
          {unmatched.data?.length === 0 && <tr><td colSpan={4} className="muted">Nothing to review.</td></tr>}
          {unmatched.data?.map((u) => (
            <tr key={u.id}>
              <td>{u.title}<div className="muted">{when(u.createdAt)}</div></td>
              <td className="mono">{u.payload.gtin ?? '—'}<div className="muted">{[u.payload.brand, u.payload.model].filter(Boolean).join(' · ')}</div></td>
              <td>{money(u.payload.priceMinor, u.payload.currency)}</td>
              <td>
                <input placeholder="Search catalog…" value={pick[u.id] ?? ''} onChange={(e) => find(u.id, e.target.value)} />
                <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                  {results[u.id]?.map((p) => (
                    <button key={p.id} style={{ textAlign: 'left' }} onClick={async () => { await post(`/v1/admin/unmatched/${u.id}/resolve`, { productId: p.id }).catch((e) => setErr(errMsg(e))); unmatched.reload(); flagged.reload(); }}>Match → {p.name}</button>
                  ))}
                  <button className="danger" onClick={async () => { await post(`/v1/admin/unmatched/${u.id}/dismiss`); unmatched.reload(); }}>Dismiss</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/* ------------------------------- Sponsored ------------------------------ */

function Sponsored() {
  const { data, reload } = useLoad(() => get<{ id: string; label: string; labelAr: string; priceMinor: number | null; url: string; active: boolean; endsAt: string | null }[]>('/v1/admin/sponsored'));
  const { data: stores } = useLoad(() => get<Store[]>('/v1/admin/stores'));
  const [f, setF] = useState({ storeId: '', label: '', labelAr: '', url: '', priceMinor: '' });
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <Header title="Sponsored placements" sub="Ads are always shown separately and labelled. They never change organic ranking or the assistant's recommendations." />
      {err && <div className="err">{err}</div>}
      <div className="card">
        <div className="form">
          <label>Store<select value={f.storeId} onChange={(e) => setF({ ...f, storeId: e.target.value })}><option value="">—</option>{stores?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label>Price (minor units, optional)<input value={f.priceMinor} onChange={(e) => setF({ ...f, priceMinor: e.target.value })} /></label>
          <label>Label (EN)<input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></label>
          <label>Label (AR)<input dir="rtl" value={f.labelAr} onChange={(e) => setF({ ...f, labelAr: e.target.value })} /></label>
          <label className="full">URL (must be on the store's allowed domains)<input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></label>
        </div>
        <div className="row" style={{ marginTop: 12 }}><button className="primary" onClick={async () => { setErr(null); try { await post('/v1/admin/sponsored', { ...f, priceMinor: f.priceMinor ? Number(f.priceMinor) : null }); reload(); } catch (e) { setErr(errMsg(e)); } }}>Add placement</button></div>
      </div>
      <table style={{ marginTop: 14 }}>
        <thead><tr><th>Label</th><th>Price</th><th>URL</th><th>State</th><th /></tr></thead>
        <tbody>{data?.map((s) => (
          <tr key={s.id}><td>{s.label}<div className="muted">{s.labelAr}</div></td><td>{money(s.priceMinor)}</td><td className="mono">{s.url}</td><td>{s.active ? <span className="pill green">active</span> : <span className="pill">paused</span>}</td>
            <td><button onClick={async () => { await patch(`/v1/admin/sponsored/${s.id}`, { active: !s.active }); reload(); }}>{s.active ? 'Pause' : 'Resume'}</button></td></tr>
        ))}</tbody>
      </table>
    </>
  );
}

/* --------------------------------- Users -------------------------------- */

function Users() {
  const [q, setQ] = useState('');
  const { data, reload } = useLoad(() => get<{ items: { id: string; email: string | null; name: string | null; role: string; plan: string; country: string; createdAt: string; lastSeenAt: string | null; lockedUntil: string | null }[] }>(`/v1/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`), [q]);
  const [err, setErr] = useState<string | null>(null);
  const act = async (id: string, body: object) => { setErr(null); try { await patch(`/v1/admin/users/${id}`, body); reload(); } catch (e) { setErr(errMsg(e)); } };
  return (
    <>
      <Header title="Users" sub="Members only (guest sessions are anonymous). Changing a role signs the user out everywhere." />
      {err && <div className="err">{err}</div>}
      <input placeholder="Search by email" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320, marginBottom: 10 }} />
      <table>
        <thead><tr><th>Email</th><th>Role</th><th>Plan</th><th>Country</th><th>Last seen</th><th /></tr></thead>
        <tbody>{data?.items.map((u) => (
          <tr key={u.id}>
            <td>{u.email}<div className="muted">{u.name}</div>{u.lockedUntil && new Date(u.lockedUntil) > new Date() && <span className="pill red">locked</span>}</td>
            <td><span className={`pill ${u.role === 'admin' ? 'warn' : ''}`}>{u.role}</span></td>
            <td>{u.plan}</td><td>{u.country}</td><td>{when(u.lastSeenAt)}</td>
            <td><div className="row">
              <button onClick={() => act(u.id, { plan: u.plan === 'pro' ? 'free' : 'pro' })}>{u.plan === 'pro' ? 'Set free' : 'Set pro'}</button>
              <button onClick={() => { if (confirm(`Change role of ${u.email}?`)) void act(u.id, { role: u.role === 'admin' ? 'user' : 'admin' }); }}>{u.role === 'admin' ? 'Remove admin' : 'Make admin'}</button>
              {u.lockedUntil && <button onClick={() => act(u.id, { unlock: true })}>Unlock</button>}
            </div></td>
          </tr>
        ))}</tbody>
      </table>
    </>
  );
}

function Audit() {
  const { data } = useLoad(() => get<{ id: string; action: string; entity: string; entityId: string | null; actorEmail: string | null; createdAt: string; data: unknown }[]>('/v1/admin/audit'));
  return (
    <>
      <Header title="Audit log" sub="Every administrative change is recorded." />
      <table>
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th></tr></thead>
        <tbody>{data?.map((a) => <tr key={a.id}><td>{when(a.createdAt)}</td><td>{a.actorEmail}</td><td><span className="pill">{a.action}</span></td><td>{a.entity} <span className="mono muted">{a.entityId}</span></td></tr>)}</tbody>
      </table>
    </>
  );
}
