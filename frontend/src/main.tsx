import './styles.css';
import './studio.css';
import './collection-refinements.css';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, NavLink, useNavigate, useParams, useLocation, Link } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChefHat, Sparkles, Carrot, Heart, BookOpen, ShoppingBasket, Settings, Search, ArrowRight, Plus, Trash2, Clock, Users, Flame, Zap, LogOut, Check, Camera, ShieldCheck, Leaf, Utensils, RotateCcw, Share2, Play, Pause, Sun, Moon, ChevronRight, ArrowUpRight, SlidersHorizontal } from 'lucide-react';
import { api, split, type Doc } from './api';
import { Button } from './components/ui/button';
import { SystemGlobalPrompt } from './components/system-global-prompt';
import { SectionSwitch, GenerationProgress, ServingsPicker, DishCountPicker, StepText, AnimatedPreferences } from './components/kitchen-experience';
import { DishImage, DishPhoto, MenuPhoto, ImageProgress, ReadingNav, Analysis, Sources, ShoppingPreview, IngredientGroups, DishInsights } from './components/recipe-details';
import { GenerationPage, beginGeneration, Reveal } from './components/generation';
import { RecipeConversation } from './components/recipe-conversation';
import { AIUpdateSection } from './components/recipe-updates';
import { defaultDishPhoto } from './resources';
import { DecorativePhoto } from './components/decorative-photo';
import { ResourceIcon } from './components/kitchen-icon';
import { KitchenLogo } from './components/kitchen-brand';
import { Welcome, DailyHeading } from './components/welcome';
import { useRecipeShare } from './components/recipe-share';
import { SaveDish } from './components/save-dish';
import { ColorStatCards } from './components/color-stat-cards';
import { gatherGeneration } from './components/generation-handoff';
import { AdminGenerations } from './components/admin-generations';
const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
function useDocs(kind: string) { return useQuery<Doc[]>({ queryKey: ['docs', kind], queryFn: () => api('/documents/' + kind), refetchInterval: q => q.state.data?.some(d => d.image_status === 'pending') ? 2000 : false }); }
function Field({ label, children }: React.PropsWithChildren<{
    label: string;
}>) { return <label className="field"><span>{label}</span>{children}</label>; }
function Empty({ text = '这里还没有记录', to }: {
    text?: string;
    to?: string;
}) { return <div className="empty"><Leaf size={32}/><h3>{text}</h3>{to && <Link className="btn primary" to={to}>开始准备 <ArrowRight size={16}/></Link>}</div>; }
function Notice({ children }: React.PropsWithChildren) { return children ? <div role="status" className="notice">{children}</div> : null; }
function AppearanceSwitch() {
    const prefs = useDocs('preferences');
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
    useEffect(() => { const observer = new MutationObserver(() => setDark(document.documentElement.dataset.theme === 'dark')); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); return () => observer.disconnect(); }, []);
    async function toggle() {
        if (busy || prefs.isPending || prefs.isError)
            return;
        setBusy(true);
        setError('');
        const previous = prefs.data || [];
        const data = { electricity_price: .9, allergies: [], avoid: [], dislikes: [], tastes: [], cuisines: [], ...(previous[0] || {}), appearance: 'qinghe', theme: dark ? 'light' : 'dark' };
        document.documentElement.dataset.theme = data.theme;
        try {
            const saved = await api('/documents/preferences' + (data.id ? '/' + data.id : ''), data.id ? 'PUT' : 'POST', data);
            client.setQueryData(['docs', 'preferences'], [saved]);
            await client.invalidateQueries({ queryKey: ['docs', 'preferences'] });
        }
        catch (e) {
            document.documentElement.dataset.theme = dark ? 'dark' : 'light';
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    return <div className="appearance-control"><button className="icon-button theme-toggle" aria-label={dark ? '切换到白天模式' : '切换到黑夜模式'} title={dark ? '切换到白天模式' : '切换到黑夜模式'} disabled={busy || prefs.isPending || prefs.isError} onClick={() => void toggle()}>{dark ? <Sun size={19}/> : <Moon size={19}/>}</button>{error && <span role="alert" className="theme-error">{error}</span>}</div>;
}
function App() {
    const route = useLocation();
    const routeGroup = route.pathname === '/' || route.pathname === '/inspire-dish' ? 'inspiration' : /^\/(recipes|dishes)$/.test(route.pathname) ? 'collection' : route.pathname.startsWith('/generating/') ? 'generation:' + (route.state?.generationSession || route.pathname.split('/')[2]) : route.pathname;
    const [welcome, setWelcome] = useState(() => !/^\/(generating|share|cook|cook-dish)(\/|$)/.test(location.pathname));
    useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [routeGroup]);
    const me = useQuery({ queryKey: ['me'], queryFn: () => api('/me') });
    const prefs = useQuery<Doc[]>({ queryKey: ['docs', 'preferences'], queryFn: () => api('/documents/preferences'), enabled: !!me.data });
    useEffect(() => { if (!prefs.data)
        return; const theme = prefs.data?.[0]?.theme || 'system'; try {
        localStorage.setItem('kitchen-theme', theme);
    }
    catch { } ; const media = matchMedia('(prefers-color-scheme: dark)'); const apply = () => { document.documentElement.dataset.theme = theme === 'dark' || theme === 'system' && media.matches ? 'dark' : 'light'; document.querySelector('meta[name="theme-color"]')?.setAttribute('content', document.documentElement.dataset.theme === 'dark' ? '#151c18' : '#eef2e6'); }; apply(); media.addEventListener('change', apply); return () => media.removeEventListener('change', apply); }, [prefs.data]);
    if (location.pathname.startsWith('/share/'))
        return <Routes><Route path="/share/:token" element={<Shared />}/></Routes>;
    if (me.isPending)
        return <div className="splash"><KitchenLogo size={58}/><p>我正在为你打开厨房…</p></div>;
    if (!me.data)
        return <Auth />;
    const section = route.pathname.startsWith('/kitchen') ? '我的厨房' : route.pathname.startsWith('/preferences') ? '饮食偏好' : /^\/(recipes|dishes|cook)/.test(route.pathname) ? '我的食谱' : route.pathname.startsWith('/shopping') ? '购物清单' : route.pathname.startsWith('/settings') ? '个人设置' : route.pathname.startsWith('/admin') ? '管理员设置' : '灵感厨房';
    return <>{welcome && <Welcome onEnter={() => { setWelcome(false); requestAnimationFrame(() => document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true })); }}/>}
 <div className="shell" inert={welcome}>
 <aside><Link to="/" className="brand"><KitchenLogo size={43}/><span className="brand-wordmark">AI Kitchen<small>有滋有味，好好生活</small></span></Link><div className="nav-label">MY EVERYDAY KITCHEN</div>
 <nav aria-label="主导航">{[['/', '灵感厨房', Sparkles], ['/kitchen', '我的厨房', Carrot], ['/recipes', '我的食谱', BookOpen], ['/shopping', '购物清单', ShoppingBasket], ['/preferences', '饮食偏好', Heart], ['/settings', '个人设置', Settings], ...(me.data.user.admin ? [['/admin', '管理设置', ShieldCheck]] : [])].map(([to, label, Icon]: any) => <NavLink key={to} to={to} aria-label={label} title={label} end className={({ isActive }) => isActive || (to === '/' && route.pathname === '/inspire-dish') || (to === '/recipes' && /^\/(recipes|dishes|cook|cook-dish)(\/|$)/.test(route.pathname)) ? 'active' : ''}><Icon size={20}/><span>{label}</span><ChevronRight size={14} className="nav-chevron"/></NavLink>)}</nav>
 <button className="sidebar-note" onClick={() => setWelcome(true)}><div className="sidebar-note-art"><DecorativePhoto controls={false}/><span><Sparkles size={19}/></span></div><small>A LITTLE TASTE OF HOME</small><p>每一餐，<br />都值得用心。</p><span className="sidebar-note-link">看看今天的开场 <ArrowUpRight size={15}/></span></button>
 <div className="account"><span className="avatar">{me.data.user.username.slice(0, 1)}</span><div><strong>{me.data.user.username}</strong><small>我的私人厨房</small></div><button aria-label="退出登录" onClick={async () => { await api('/logout', 'POST'); client.clear(); location.href = '/'; }}><LogOut size={17}/></button></div></aside>
 <main><header className="app-toolbar"><div className="toolbar-location"><KitchenLogo size={29}/><span>我的厨房 <ChevronRight size={13}/> <strong>{section}</strong></span></div><div className="toolbar-actions"><span className="toolbar-ai"><i />我的 AI 厨房伙伴</span><AppearanceSwitch /><Link className="avatar toolbar-avatar" to="/settings" aria-label="账号设置">{me.data.user.username.slice(0, 1)}</Link></div></header>
 <div className={"route-view" + (route.pathname.startsWith("/generating/") ? " is-generation-route" : "")} key={routeGroup}><Routes><Route path="/" element={<Generate key="menu"/>}/><Route path="/inspire-dish" element={<Generate key="dish" single/>}/><Route path="/dishes" element={<Collection kind="dishes"/>}/><Route path="/generating/:id" element={<GenerationPage render={(r, single) => single ? <DishView d={r}/> : <RecipeView r={r}/>}/>}/><Route path="/dishes/:id" element={<DishPage />}/><Route path="/kitchen" element={<Kitchen />}/><Route path="/preferences" element={<Preferences />}/><Route path="/recipes" element={<Collection kind="recipes"/>}/><Route path="/recipes/:id" element={<RecipePage />}/><Route path="/cook/:id" element={<Cooking />}/><Route path="/cook-dish/:id" element={<Cooking single/>}/><Route path="/shopping" element={<Shopping />}/><Route path="/settings" element={<Preferences settings/>}/><Route path="/admin" element={<Admin />}/><Route path="*" element={<Empty text="页面不存在" to="/"/>}/></Routes></div>
 <footer className="app-footer"><span>AI Kitchen <i>·</i> 把日子，煮成喜欢的样子。</span><span>MADE WITH A LITTLE LOVE <Heart size={11}/></span></footer></main></div></>;
}
function Auth() { const [register, setRegister] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false); const cap = useQuery({ queryKey: ['capabilities'], queryFn: () => api('/capabilities') }); return <div className="auth"><div className="auth-art"><KitchenLogo size={58}/><p className="eyebrow">YOUR PERSONAL KITCHEN COMPANION</p><h1>一日三餐，<br />有滋有味。</h1><p>从冰箱里的一点灵感，到餐桌上的一顿好饭。<br />你的私人 AI 厨房助手。</p><DecorativePhoto className="auth-food"/></div><form className="auth-form" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(''); try {
    const body = Object.fromEntries(new FormData(e.currentTarget));
    await api(register ? '/register' : '/login', 'POST', body);
    await client.invalidateQueries({ queryKey: ['me'] });
}
catch (e) {
    setError((e as Error).message);
}
finally {
    setBusy(false);
} }}><span className="eyebrow">欢迎来到 AI KITCHEN</span><h2>{register ? '开启你的厨房' : '好久不见，开饭吧'}</h2><p className="muted">{register ? '创建账号，收藏属于你的家常味道。' : '登录，继续你的美味日常。'}</p><Field label="用户名"><input name="username" required minLength={2} maxLength={64} autoComplete="username"/></Field><Field label="密码"><input name="password" type="password" required minLength={register ? 10 : 1} maxLength={72} autoComplete={register ? 'new-password' : 'current-password'}/></Field>{register && <Field label="邀请码（如管理员有设置）"><input name="invite_code"/></Field>}<Notice>{error}</Notice><Button disabled={busy}>{busy ? '请稍候…' : register ? '创建账号' : '登录厨房'}<ArrowRight size={17}/></Button>{cap.data?.registration && <button type="button" className="text-button" onClick={() => setRegister(!register)}>{register ? '已有账号？去登录' : '还没有账号？立即注册'}</button>}</form></div>; }
function Title({ kicker, title, desc }: {
    kicker: string;
    title: string;
    desc: string;
}) { return <div className="page-title"><span className="eyebrow">{kicker}</span><h1 tabIndex={-1}>{title}</h1><p>{desc}</p></div>; }
function Generate({ single = false }: {
    single?: boolean;
}) { const nav = useNavigate(); const storageKey = 'generation:' + (single ? 'dish:' : 'menu:') + client.getQueryData<any>(['me'])?.user?.id; const [draft] = useState<any>(() => { try {
    return JSON.parse(localStorage.getItem(storageKey) || '{}');
}
catch {
    return {};
} }); const equipment = useDocs('equipment'), recipes = useDocs('recipes'), custom = useDocs('tags'); const caps = useQuery({ queryKey: ['capabilities'], queryFn: () => api('/capabilities') }); const tags = useQuery({ queryKey: ['tags'], queryFn: () => api('/tags') }); const [ingredients, setIngredients] = useState<string[]>(draft.ingredients || []), [ingredient, setIngredient] = useState(''), [selected, setSelected] = useState<string[]>(draft.tags || []), [ids, setIds] = useState<number[]>(draft.equipment_ids || []), [mode, setMode] = useState(draft.mode || 'random'), [error, setError] = useState(''), [busy, setBusy] = useState(false), [job, setJob] = useState<number | null>(draft.job || null), [vision, setVision] = useState<any[]>([]), [reuseExisting, setReuseExisting] = useState(draft.reuse_existing ?? true), [search, setSearch] = useState(draft.search ?? false); useEffect(() => { if (caps.data && draft.search === undefined)
    setSearch(!!caps.data.search); }, [caps.data]); const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api('/jobs') }); useEffect(() => { const active = jobs.data?.find((j: any) => !['completed', 'failed'].includes(j.status)); if (active && !busy)
    nav('/generating/' + active.id); }, [jobs.data]); const progress = useQuery({ queryKey: ['job', job], queryFn: () => api('/jobs/' + job), enabled: !!job, refetchInterval: q => ['completed', 'failed'].includes((q.state.data as any)?.status) ? false : 1500 }); useEffect(() => { if (progress.data?.status === 'completed') {
    try {
        localStorage.setItem(storageKey, JSON.stringify({ ...JSON.parse(localStorage.getItem(storageKey) || '{}'), job: null }));
    }
    catch { }
    client.invalidateQueries({ queryKey: ['docs', 'recipes'] });
    client.invalidateQueries({ queryKey: ['docs', 'dishes'] });
    nav('/' + (progress.data.result_kind || 'recipes') + '/' + progress.data.recipe_id);
} }, [progress.data, nav]); const stages: Record<string, string> = { pending: '正在排队', analyzing: '理解需求与厨房配置', searching: '搜索真实菜谱参考', planning: '我在安排下一步', search_web: '我在寻找好做法', view_image: '我在挑选清晰的参考图', fetch_page: '我在细读做法', check_menu: '我在核对搭配方案', validating: '校验条件与计算营养', repairing: '修正菜谱约束', saving: '保存菜单', completed: '已完成', failed: '这次没能做好' }; const active = job && !progress.isError && !['failed', 'completed'].includes(progress.data?.status); function add() { if (ingredient.trim()) {
    setIngredients([...new Set([...ingredients, ...split(ingredient)])]);
    setIngredient('');
} } return <><section className="page-title inspiration-heading"><div className="hero-copy"><DailyHeading /></div><figure className="hero-photo"><DecorativePhoto/><figcaption><Sparkles size={15}/><span>一点心意，一桌好饭<small>YOUR EVERYDAY AI CHEF</small></span></figcaption><span className="hero-photo-mark">FRESH IDEAS, EVERY DAY <ArrowUpRight size={17}/></span></figure></section><SectionSwitch kind="inspiration" single={single}/><div className="workspace"><form className="card generator" id="inspiration-form" onSubmit={async (e) => { e.preventDefault(); if (busy) return; const form = e.currentTarget; setError(''); setBusy(true); const f = new FormData(form); try {
    const request = { target: single ? 'dish' : 'menu', servings: Number(f.get('servings')), ingredients: mode === 'random' ? [] : [...new Set([...ingredients, ...split(ingredient)])], mode, equipment_ids: ids, minutes: f.get('minutes') ? Number(f.get('minutes')) : null, budget: f.get('budget') ? Number(f.get('budget')) : null, dish_count: single ? 1 : Number(f.get('dish_count')), description: f.get('description'), tags: selected, search, reuse_existing: reuseExisting };
    try {
        localStorage.setItem(storageKey, JSON.stringify(request));
    }
    catch { }
    const token = beginGeneration(request, storageKey);
    await gatherGeneration(form, request, () => nav('/generating/' + token, { state: { single, generationSession: token } }));
    return;
}
catch (e) {
    setError((e as Error).message);
}
finally {
    setBusy(false);
} }}><div className="section-heading"><div><h2><Sparkles size={21}/>{single ? '为我设计一道菜' : '为我搭配一桌菜单'}</h2><p>两个小选择，开启一餐好味道</p></div><span className="ai-presence"><Sparkles size={13}/>AI 灵感在线</span></div><div className="form-section"><h3><span>01</span> 选择灵感方式</h3><div className="segmented" style={{ '--selection': ['random', 'mixed', 'strict'].indexOf(mode) } as React.CSSProperties}><span className="mode-indicator" aria-hidden="true"/>{[['random', '灵感模式', '自由搭配，不必指定食材'], ['mixed', '混合模式', '用指定食材，允许添购'], ['strict', '限制模式', '仅用指定食材与已有调料']].map(([v, l, desc]) => <button type="button" key={v} className={mode === v ? 'selected' : ''} aria-pressed={mode === v} onClick={() => setMode(v)}><strong>{l}</strong><small>{desc}</small></button>)}</div>{mode !== 'random' && <><div className="input-row ingredient-entry"><div className="ingredient-input"><div className="ingredient-tokens">{ingredients.map(i => <button type="button" key={i} aria-label={"移除食材 " + i} onClick={() => setIngredients(ingredients.filter(x => x !== i))}>{i}<span aria-hidden="true"> ×</span></button>)}</div><input list="food-suggestions" value={ingredient} onChange={e => setIngredient(e.target.value)} aria-label="食材名称" onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
    e.preventDefault();
    add();
} }} placeholder={ingredients.length ? "继续添加食材…" : "试试：番茄、鸡蛋、西兰花"}/></div><Button type="button" variant="secondary" onClick={add}><Plus size={18}/>添加</Button></div><p className="hint">多个食材可用逗号或顿号分隔；按回车或点击添加，我会一起用上输入框里的食材。</p><datalist id="food-suggestions">{['番茄', '鸡蛋', '西兰花', '鸡胸肉', '土豆', '豆腐', '牛腩', '胡萝卜'].map(x => <option key={x}>{x}</option>)}</datalist><details className="photo-upload"><summary><Camera size={16}/> 拍照识别食材</summary><label className="upload"><Camera size={18}/>{busy ? '识别中…' : '拍照 / 上传照片识别食材'}<input aria-label="上传食材照片" type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={async (e) => { if (!e.target.files?.length)
    return; setBusy(true); setError(''); try {
    const f = new FormData();
    Array.from(e.target.files).forEach(file => f.append('images', file));
    const r = await api('/vision', 'POST', f);
    setVision(r.ingredients);
}
catch (e) {
    setError((e as Error).message);
}
finally {
    setBusy(false);
    e.target.value = '';
} }}/><small>最多 4 张 · 识别后由你确认</small></label></details>{vision.length > 0 && <div className="notice"><p>识别仅供参考，请确认食材，不推测数量。</p>{vision.map((v, i) => <div className="input-row" key={i}><input value={v.name} onChange={e => setVision(vision.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}/><span>{Math.round(v.confidence * 100)}%</span><button type="button" onClick={() => setVision(vision.filter((_, j) => j !== i))}>移除</button></div>)}<Button type="button" onClick={() => { setIngredients([...new Set([...ingredients, ...vision.map(v => v.name).filter(Boolean)])]); setVision([]); }}>确认食材</Button></div>}</>}</div><div className="form-section"><h3><span>02</span> 为几个人准备？</h3><div className="grid two"><Field label="用餐人数"><ServingsPicker initial={draft.servings ?? 2}/></Field>{!single && <Field label="菜品数量"><DishCountPicker initial={draft.dish_count ?? 0}/></Field>}</div></div><AnimatedPreferences><div className="grid two"><Field label="可用时间 / 分钟"><input name="minutes" defaultValue={draft.minutes ?? ''} type="number" min="1" placeholder="不限时间"/></Field><Field label="整餐预算 / 元"><input name="budget" defaultValue={draft.budget ?? ''} type="number" min="1" step="0.1" placeholder="不限预算"/></Field><div className="field" role="group" aria-label="使用炊具"><span>使用炊具</span><div className="chips">{equipment.data?.map(e => <button type="button" className={ids.includes(e.id) ? 'active' : ''} key={e.id} onClick={() => setIds(ids.includes(e.id) ? ids.filter(x => x !== e.id) : [...ids, e.id])}><ResourceIcon name={e.name} kind="equipment" size={22}/>{e.name}</button>)}{!equipment.data?.length && <Link to="/kitchen">先添加你的炊具 →</Link>}</div></div></div><p className="hint">不选炊具时，使用厨房中全部已配置设备。</p><div className="form-section"><h3><span>03</span> 更懂你的口味</h3><div className="chips tag-chips">{[...new Set([...(tags.data?.defaults || []), ...(tags.data?.global || []).map((x: any) => x.name), ...(custom.data || []).map(x => x.name), ...selected])].map((t: any) => <button key={t} type="button" aria-pressed={selected.includes(t)} className={selected.includes(t) ? 'active' : ''} onClick={() => setSelected(selected.includes(t) ? selected.filter(x => x !== t) : [...selected, t])}>{t}</button>)}</div><PersonalTagInput onAdded={names => setSelected(previous => [...new Set([...previous, ...names])])}/><p className="hint">标签长期保存，可在 <Link to="/preferences">饮食偏好</Link> 中增删。</p><textarea aria-label="其他饮食偏好" name="description" defaultValue={draft.description || ''} maxLength={4000} placeholder="还有什么想法？例如：想一锅出，少洗几个碗，适合明天带饭…" rows={3}/></div><label className="check-row"><input type="checkbox" checked={reuseExisting} onChange={e => setReuseExisting(e.target.checked)}/><span>优先复用我的历史菜品与菜单</span></label><p className="hint">我会先看看历史食谱里有没有符合人数、食材和口味的好菜，没有合适的，我再为你重新搭配。</p><label className="check-row"><input type="checkbox" disabled={!caps.data?.search} checked={!!caps.data?.search && search} onChange={e => setSearch(e.target.checked)}/><span>让我联网寻找好做法</span></label></AnimatedPreferences>{caps.data && !caps.data.llm && <Notice>AI 服务尚未配置。请在服务器 config.yaml 中设置模型与密钥；厨房管理功能可以正常使用。</Notice>}<Notice>{error || progress.data?.error || progress.error?.message}</Notice>{job && <GenerationProgress job={progress.data} connecting={!progress.data} error={progress.error?.message}/>}{active ? <div className="progress"><Sparkles className="working-sparkle"/>{stages[progress.data?.status] || '正在提交任务'}<small>你可以离开页面，任务会继续处理。</small></div> : <Button className="generate-button" disabled={busy || !caps.data?.llm}><Sparkles size={19}/>{busy ? '正在提交…' : single ? '帮我做一道菜' : '帮我搭配这一餐'}<ArrowRight size={18}/></Button>}</form><div className="right-column"><div className="kitchen-context"><span className="context-icon"><ChefHat size={28}/><i /></span><span className="eyebrow">A LITTLE HELP FROM AI</span><h3>你想吃什么，<br />我来想办法。</h3><p>我会记得你的口味，也熟悉你手边的 {equipment.data?.length || 0} 件炊具。</p><Link to="/kitchen">我的厨房档案 <ArrowUpRight size={16}/></Link></div><div className="card inspiration-picks"><div className="section-heading"><h3>从这一口开始</h3><span>IDEAS</span></div>{[{ name: "番茄炒蛋", foods: ["番茄", "鸡蛋"], note: "酸甜开胃 · 家常好味" }, { name: "香菇炖鸡", foods: ["香菇", "鸡腿"], note: "暖暖一锅 · 满屋飘香" }].map(d => <button type="button" className="inspiration-pick" key={d.name} onClick={() => { setMode("mixed"); setIngredients(d.foods); document.getElementById("inspiration-form")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" }); }}><img src={defaultDishPhoto({ name: d.name }).src} alt={d.name + " · 灵感示意图"}/><span><strong>{d.name}</strong><small>{d.note}</small></span><ArrowUpRight size={17}/></button>)}</div><div className="card"><div className="section-heading"><h3>最近的美味</h3><Link to="/recipes">全部 →</Link></div>{recipes.data?.length ? recipes.data.slice(0, 3).map((r, i) => <Link className="recent" to={'/recipes/' + r.id} key={r.id}><span className={'food-icon tone' + i}><DishImage dish={r.dishes?.[0] || { name: r.title }}/></span><div><strong>{r.title}</strong><small>{r.servings} 人 · {r.total_elapsed_minutes} 分钟</small></div><ArrowRight size={16}/></Link>) : <div className="recent-empty"><BookOpen size={25}/><strong>第一顿好饭，从这里开始</strong><p>我为你搭配的菜单会留在这里，慢慢收藏属于你的家常味道。</p></div>}</div></div></div></>; }
type FieldDef = {
    key: string;
    label: string;
    type?: string;
    options?: string[];
};
const equipmentFields: FieldDef[] = [{ key: 'name', label: '炊具名称' }, { key: 'capacity', label: '容积 / 尺寸', type: 'number' }, { key: 'unit', label: '单位', options: ['L', 'ml', 'cm'] }, { key: 'electric', label: '这是电器', type: 'checkbox' }, { key: 'watts', label: '额定功率 W（未知请留空）', type: 'number' }, { key: 'description', label: '设备能力、压力、温度与使用限制', type: 'textarea' }];
const pantryFields: FieldDef[] = [{ key: 'name', label: '食材 / 调料名称' }, { key: 'category', label: '分类', options: ['食材', '调料'] }, { key: 'quantity', label: '数量（可选）', type: 'number' }, { key: 'unit', label: '单位', options: ['g', 'kg', 'ml', 'L', '个', '包'] }, { key: 'notes', label: '备注', type: 'textarea' }];
const priceFields: FieldDef[] = [{ key: 'name', label: '食材名称' }, { key: 'price', label: '单价（元）', type: 'number' }, { key: 'unit', label: '计价单位', options: ['kg', 'g', '个', 'L', 'ml'] }, { key: 'calories', label: '每 100g 热量 kcal（可选）', type: 'number' }, { key: 'protein', label: '蛋白质 g', type: 'number' }, { key: 'fat', label: '脂肪 g', type: 'number' }, { key: 'carbs', label: '碳水 g', type: 'number' }];
function Manager({ kind, fields, title }: {
    kind: string;
    fields: FieldDef[];
    title: string;
}) { const q = useDocs(kind), qc = useQueryClient(); const [edit, setEdit] = useState<Doc | Record<string, any> | null>(null), [error, setError] = useState(''), [saving, setSaving] = useState(false); return <><div className="section-heading"><h2>{title}</h2><Button onClick={() => setEdit({})}><Plus size={17}/>添加</Button></div><Notice>{error || q.error?.message}</Notice>{!q.data?.length ? <Empty text={'添加你的第一项' + title}/> : <div className="grid three">{q.data.map(d => <div className="card item-card" key={d.id}><div className="item-symbol">{kind === 'tags' ? <Leaf /> : <ResourceIcon name={d.name} kind={kind === 'equipment' ? 'equipment' : 'ingredient'} size={30}/>}</div><h3>{d.name}</h3><p>{kind === 'equipment' ? `${d.capacity ?? '未知容量'} ${d.unit || ''} · ${d.electric ? (d.watts == null ? '功率未设置' : d.watts + ' W') : '非电器'}` : kind === 'prices' ? `¥ ${d.price ?? '未知'} / ${d.unit}` : kind === 'tags' ? '搭配菜单、编辑菜品时都能使用' : `${d.category} · ${d.quantity ?? '未记录数量'} ${d.unit || ''}`}</p><p className="muted">{d.description || d.notes || '暂无补充说明'}</p><div className="actions"><Button variant="secondary" onClick={() => setEdit({ ...d, ...d.nutrition_per_100g })}>编辑</Button><Button variant="ghost" aria-label={'删除' + d.name} onClick={async () => { if (!confirm('删除 ' + d.name + '？'))
    return; try {
    await api(`/documents/${kind}/${d.id}`, 'DELETE');
    qc.invalidateQueries({ queryKey: ['docs', kind] });
}
catch (e) {
    setError((e as Error).message);
} }}><Trash2 size={17}/></Button></div></div>)}</div>}{edit && <div className="modal-backdrop"><form role="dialog" aria-modal="true" aria-label={title} className="modal card" onSubmit={async (e) => { e.preventDefault(); setSaving(true); try {
    const body = { ...edit };
    for (const f of fields) {
        if (f.type === 'number')
            body[f.key] = body[f.key] === '' || body[f.key] == null ? null : Number(body[f.key]);
        if (f.options && !body[f.key])
            body[f.key] = f.options[0];
    }
    ;
    if (kind === 'prices') {
        body.nutrition_per_100g = body.calories == null ? null : { calories: body.calories, protein: body.protein || 0, fat: body.fat || 0, carbs: body.carbs || 0 };
        for (const key of ['calories', 'protein', 'fat', 'carbs'])
            delete body[key];
    }
    ;
    await api('/documents/' + kind + (edit.id ? '/' + edit.id : ''), edit.id ? 'PUT' : 'POST', body);
    setEdit(null);
    qc.invalidateQueries({ queryKey: ['docs', kind] });
}
catch (e) {
    setError((e as Error).message);
}
finally {
    setSaving(false);
} }}><h2>{edit.id ? '编辑' : '添加'}{title}</h2>{fields.filter(f => f.key !== 'watts' || edit.electric).map(f => <Field key={f.key} label={f.label}>{f.options ? <select value={edit[f.key] || f.options[0]} onChange={e => setEdit({ ...edit, [f.key]: e.target.value })}>{f.options.map(o => <option key={o}>{o}</option>)}</select> : f.type === 'textarea' ? <textarea value={edit[f.key] || ''} onChange={e => setEdit({ ...edit, [f.key]: e.target.value })}/> : <input type={f.type || 'text'} step="any" min="0" required={f.key === 'name'} checked={!!edit[f.key]} value={f.type === 'checkbox' ? undefined : edit[f.key] ?? ''} onChange={e => setEdit({ ...edit, [f.key]: f.type === 'checkbox' ? e.target.checked : e.target.value })}/>}</Field>)}<Notice>{error}</Notice><div className="actions"><Button disabled={saving}>保存</Button><Button variant="secondary" type="button" onClick={() => { setEdit(null); setError(''); }}>取消</Button></div></form></div>}</>; }
function Kitchen() { const [tab, setTab] = useState('equipment'); return <div className="page"><Title kicker="MY KITCHEN" title="美味，从我的厨房开始" desc="记录手边的炊具与食材，让每个建议都切合实际。"/><div className="tabs">{[['equipment', '我的炊具'], ['pantry', '食材与调料'], ['prices', '食材价格']].map(([v, l]) => <button key={v} className={tab === v ? 'active' : ''} onClick={() => setTab(v)}>{l}</button>)}</div><Manager key={tab} kind={tab} title={tab === 'equipment' ? '炊具' : tab === 'pantry' ? '库存' : '价格档案'} fields={tab === 'equipment' ? equipmentFields : tab === 'pantry' ? pantryFields : priceFields}/></div>; }
function Preferences({ settings = false }: {
    settings?: boolean;
}) { const q = useDocs('preferences'); const [data, setData] = useState<any>({ auto_search_images: false, appearance: 'qinghe', theme: 'system', electricity_price: .9, allergies: [], avoid: [], dislikes: [], tastes: [], cuisines: [] }), [message, setMessage] = useState(''); useEffect(() => { if (q.data?.[0])
    setData({ auto_search_images: false, appearance: 'qinghe', ...q.data[0] }); }, [q.data]); return <div className="page narrow"><Title kicker={settings ? 'SETTINGS' : 'MADE FOR YOU'} title={settings ? '让厨房更合心意' : '每一口，都懂你'} desc={settings ? '账号、主题、自动配图、用电价格和个人全局提示词，在这里管理。' : '我会记住你的过敏与忌口，请准确填写。'}/><form className="card form-stack" onSubmit={async (e) => { e.preventDefault(); try {
    const saved = await api('/documents/preferences' + (data.id ? '/' + data.id : ''), data.id ? 'PUT' : 'POST', data);
    client.setQueryData(['docs', 'preferences'], [saved]);
    client.invalidateQueries({ queryKey: ['docs', 'preferences'] });
    setMessage('已保存');
}
catch (e) {
    setMessage((e as Error).message);
} }}>{settings ? <><div><label className="check-row"><input type="checkbox" checked={data.auto_search_images === true} onChange={e => setData({ ...data, auto_search_images: e.target.checked })}/><span>生成后自动查找参考图</span></label><p className="hint">默认关闭，仅对你的账号生效。开启并保存后，使用联网生成时会在菜谱完成后后台查找并核验参考图；需要服务器已配置搜索服务和视觉模型。</p></div><Field label="个人全局提示词"><textarea aria-label="个人全局提示词" value={data.global_prompt || ''} onChange={e => setData({ ...data, global_prompt: e.target.value })} maxLength={10000} rows={6} placeholder="例如：优先选择当季食材，做法尽量简单，步骤中说明火候。"/><small className="hint">仅对你的账号生效，保存后自动带入之后的菜单、单菜制作及调整。最多 10000 字，留空可取消；与系统提示词冲突时以系统提示词为准。</small></Field><Field label="外观主题"><select value={data.appearance || 'qinghe'} onChange={e => setData({ ...data, appearance: e.target.value })}><option value="qinghe">青禾 · 奶油白与森林绿</option></select><small className="hint">同一套外观，包含日光与夜色两种配色。</small></Field><Field label="昼夜模式"><select value={data.theme || 'system'} onChange={e => setData({ ...data, theme: e.target.value })}><option value="system">跟随系统</option><option value="light">白天模式</option><option value="dark">黑夜模式</option></select></Field><Field label="电价（元 / kWh）"><input type="number" step="0.01" min="0" required value={data.electricity_price} onChange={e => setData({ ...data, electricity_price: Number(e.target.value) })}/></Field></> : <>{[['allergies', '过敏原'], ['avoid', '忌口食物'], ['dislikes', '不喜欢的食材'], ['tastes', '喜欢的口味'], ['cuisines', '常用菜系']].map(([k, l]) => <Field key={k} label={l + '（逗号分隔）'}><input defaultValue={(data[k] || []).join('，')} key={JSON.stringify(q.data) + k} onBlur={e => setData({ ...data, [k]: split(e.target.value) })}/></Field>)}<Field label="其他饮食习惯"><textarea value={data.notes || ''} onChange={e => setData({ ...data, notes: e.target.value })}/></Field></>}<Notice>{message}</Notice><Button disabled={q.isPending || q.isError}>保存设置</Button></form>{settings ? <><Account /><Button className="mt" variant="secondary" onClick={async () => { await api('/logout', 'POST'); client.clear(); location.href = '/'; }}><LogOut size={16}/>退出登录</Button></> : <div className="mt"><Manager kind="tags" title="个人标签" fields={[{ key: 'name', label: '标签名称' }]}/></div>}</div>; }
function PersonalTagInput({ onAdded }: {
    onAdded: (names: string[]) => void;
}) {
    const custom = useDocs('tags');
    const [value, setValue] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
    async function add() {
        const names = [...new Set(split(value))];
        if (!names.length || busy || !custom.data)
            return;
        setBusy(true);
        setError('');
        try {
            for (const name of names) {
                if (!custom.data.some(t => t.name === name))
                    await api('/documents/tags', 'POST', { name });
                onAdded([name]);
            }
            setValue('');
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            await client.invalidateQueries({ queryKey: ['docs', 'tags'] });
            setBusy(false);
        }
    }
    return <><div className="input-row"><input aria-label="新增个人标签" value={value} disabled={busy} maxLength={200} placeholder="新增标签，可用逗号分隔" onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
        e.preventDefault();
        void add();
    } }}/><Button type="button" variant="secondary" disabled={busy || !custom.data || !value.trim()} onClick={() => void add()}><Plus size={16}/>{busy ? '保存中…' : '保存标签'}</Button></div><Notice>{error || custom.error?.message}</Notice></>;
}
function Account() { const [message, setMessage] = useState(''); return <form className="card form-stack mt" onSubmit={async (e) => { e.preventDefault(); try {
    await api('/account', 'PUT', Object.fromEntries(new FormData(e.currentTarget)));
    client.invalidateQueries({ queryKey: ['me'] });
    setMessage('账号已更新，其他会话已退出');
}
catch (e) {
    setMessage((e as Error).message);
} }}><h2>账号信息与密码</h2><Field label="新用户名（可选）"><input name="username"/></Field><Field label="当前密码"><input name="old_password" type="password" required autoComplete="current-password"/></Field><Field label="新密码（可选，至少 10 字节）"><input name="new_password" type="password" autoComplete="new-password"/></Field><Notice>{message}</Notice><Button>更新账号</Button></form>; }
function Collection({ kind }: {
    kind: 'recipes' | 'dishes';
}) {
    const menu = kind === 'recipes';
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [query, setQuery] = useState(''), [tab, setTab] = useState('all'), [selected, setSelected] = useState<string[]>([]), [servings, setServings] = useState(''), [min, setMin] = useState(''), [max, setMax] = useState('');
    const menus = useDocs('recipes'), dishes = useDocs('dishes');
    const all = menu ? menus : dishes;
    const tags = [...new Set<string>((all.data || []).flatMap(x => x.tags || []))];
    const params = new URLSearchParams({ q: query, servings, min_cost: min, max_cost: max });
    if (tab !== 'all')
        params.set(tab, 'true');
    else params.set('recent', 'true');
    selected.forEach(t => params.append('tag', t));
    const q = useQuery<Doc[]>({ queryKey: ['docs', kind, params.toString()], queryFn: () => api('/documents/' + kind + '?' + params), placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === kind ? previous : undefined, initialData: !query && tab === 'all' && !selected.length && !servings && !min && !max ? all.data?.slice(0, 50) : undefined, refetchInterval: q => q.state.data?.some(d => d.image_status === 'pending') ? 2000 : false });
    const filterCount = [query, servings, min, max].filter(Boolean).length + selected.length;
    return <div className="page"><Title kicker="THE RECIPE JOURNAL" title="我的食谱" desc="收藏一桌好饭，也珍藏每一道拿手菜。"/><SectionSwitch kind="collection" single={!menu}/><div className="collection-toolbar"><div className="tabs">{[['all', '最近生成'], ['saved', '已保存'], ['favorite', '收藏']].map(([v, l]) => <button key={v} className={tab === v ? 'active' : ''} onClick={() => setTab(v)}>{l}</button>)}</div><button type="button" className={"collection-filter-toggle" + (filtersOpen ? " is-open" : "")} aria-expanded={filtersOpen} aria-controls={"collection-filters-" + kind} onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={17}/><span>搜索与筛选</span>{filterCount > 0 && <small aria-label={filterCount + " 项筛选"}>{filterCount}</small>}<ChevronRight size={15} className="filter-chevron"/></button></div><div id={"collection-filters-" + kind} className={"collection-filter-disclosure" + (filtersOpen ? " is-open" : "")} inert={!filtersOpen} aria-hidden={!filtersOpen}><div className="collection-filter-inner"><div className="collection-filters card"><Field label={menu ? '搜索菜单名称' : '搜索菜品名称'}><span className="collection-search"><Search size={19} aria-hidden="true"/><input type="search" placeholder={menu ? '搜索想吃的菜单…' : '搜索收藏的菜品…'} value={query} onChange={e => setQuery(e.target.value)}/></span></Field><Field label="用餐人数"><input type="number" min="1" max="10" placeholder="不限" value={servings} onChange={e => setServings(e.target.value)}/></Field><Field label="最低费用 / 元"><input type="number" min="0" placeholder="不限" value={min} onChange={e => setMin(e.target.value)}/></Field><Field label="最高费用 / 元"><input type="number" min="0" placeholder="不限" value={max} onChange={e => setMax(e.target.value)}/></Field></div><div className="chips tag-chips">{tags.map(t => <button key={t} aria-pressed={selected.includes(t)} className={selected.includes(t) ? 'active' : ''} onClick={() => setSelected(selected.includes(t) ? selected.filter(x => x !== t) : [...selected, t])}>{t}</button>)}<button onClick={() => { setSelected([]); setQuery(''); setServings(''); setMin(''); setMax(''); setTab('all'); }}>清空筛选</button></div></div></div><Notice>{q.error?.message}</Notice><div className="collection-results" aria-busy={q.isFetching}>{q.isPending ? <p role="status">正在搜索…</p> : <><p className="result-count">找到 {q.data?.length || 0} {menu ? '份菜单' : '道菜品'}</p>{tab === 'all' && <p className="hint">最近生成保留 50 条，保存或收藏后可长期保留。</p>}{!q.data?.length && <Empty text="还没有这份美味" to={menu ? '/' : '/inspire-dish'}/>}<div className="recipe-grid">{q.data?.map(r => <Link key={r.id} to={'/' + kind + '/' + r.id} className="card recipe-card"><div className="recipe-cover"><DishImage dish={menu ? (r.dishes?.[0] || { name: r.title, tags: r.tags }) : r}/><ResourceIcon name={menu ? (r.dishes?.[0]?.name || r.title) : r.name} kind="dish" size={38}/><span>{menu ? '一桌好饭' : '一道拿手菜'}</span><small>{r.favorite ? '♥ 珍藏' : '私人食谱'}</small></div><div className="recipe-content"><h3>{menu ? r.title : r.name}</h3><p>{menu ? r.summary : r.description}</p><div className="recipe-meta"><span><Users size={14}/>{r.servings} 人</span><span>¥{(menu ? r.total_cost : r.cost) == null ? '—' : Number(menu ? r.total_cost : r.cost).toFixed(2)}</span><span><Clock size={14}/>{menu ? r.total_elapsed_minutes : (r.prep_minutes || 0) + (r.cook_minutes || 0)} 分钟</span></div><div className="chips tag-chips">{r.tags?.slice(0, 3).map((t: string) => <span key={t}>{t}</span>)}</div></div></Link>)}</div></>}</div></div>;
}
function DishPage() { const { id } = useParams(); const q = useQuery<Doc>({ queryKey: ['document', 'dishes', id], queryFn: () => api('/documents/dishes/' + id), refetchInterval: q => q.state.data?.image_status === 'pending' ? 2000 : false }); const d = q.data; if (!d)
    return <div className="page">{q.isPending ? '正在加载…' : q.error?.message || '菜品不存在'}</div>; return <RecipeConversation key={'dish:'+d.id} recipe={d} kind="dishes" assistant>{()=><DishView d={d}/>}</RecipeConversation>; }
function DishView({ d }: {
    d: Doc;
}) { const id = d.id, nav = useNavigate(); const [message, setMessage] = useState(''), [updating, setUpdating] = useState(false); const updateLock = useRef(false); async function update(p: any) { if (updateLock.current) return; updateLock.current = true; setUpdating(true); setMessage(p.saved !== undefined ? '正在保存…' : '正在更新…'); try {
    await api('/documents/dishes/' + id, 'PUT', { ...d, ...p });
    await client.invalidateQueries({ queryKey: ['docs', 'dishes'] });
    await client.invalidateQueries({ queryKey: ['generation-result'] });
    await client.invalidateQueries({ queryKey: ['document'] });
    setMessage(p.saved === true ? '菜品已保存' : p.saved === false ? '已取消保存' : '更改已保存');
}
catch (e) {
    setMessage((e as Error).message);
} finally { updateLock.current = false; setUpdating(false); } } return <div className="page dish-reading"><Link className="back-link" to="/dishes">← 返回我的食谱</Link><ReadingNav single/><Reveal index={0}><div id="overview" className="recipe-overview"><Title kicker="YOUR DISH" title={d.name} desc={d.description}/><DishPhoto dish={d}/><ImageProgress status={d.image_status}/></div></Reveal><Reveal index={1}><ColorStatCards label="餐食概况" className="overview-stats" items={[{id:'servings',label:'用餐人数',value:d.servings??'—',unit:'人',icon:Users,tone:'lime'},{id:'time',label:'准备与烹饪',value:(d.prep_minutes || 0) + (d.cook_minutes || 0),unit:'分钟',icon:Clock,tone:'butter'},{id:'cost',label:'食材消耗成本 · 估算',value:d.cost == null ? '—' : Number(d.cost).toFixed(2),unit:'元',icon:ShoppingBasket,tone:'orange'}]}/></Reveal><div className="actions wrap"><Button disabled={!d.steps?.length} onClick={() => nav('/cook-dish/' + id)}><Play size={17}/>开始烹饪</Button><Button variant="secondary" disabled={updating} onClick={() => update({ saved: !d.saved })}>{d.saved ? '取消保存' : '保存菜品'}</Button><Button variant="secondary" disabled={updating} onClick={() => update({ favorite: !d.favorite })}>{d.favorite ? '取消收藏' : '收藏菜品'}</Button><Button variant="ghost" onClick={async () => { if (!confirm('删除这道独立菜品？'))
    return; try {
    await api('/documents/dishes/' + id, 'DELETE');
    await client.invalidateQueries({ queryKey: ['docs', 'dishes'] });
    nav('/dishes');
}
catch (e) {
    setMessage((e as Error).message);
} }}>删除</Button></div><Notice>{message}</Notice>{d.warnings?.map((w: string, i: number) => <Notice key={i}>{w}</Notice>)}<AIUpdateSection section="tags"><DishTags tags={d.tags} shared={false} save={tags => update({ tags })}/></AIUpdateSection><div className="dish-detail-grid"><Reveal index={2}><div className="card" id="ingredients"><h3><Carrot size={20}/>准备好这些食材</h3><IngredientGroups ingredients={d.ingredients}/></div></Reveal><Reveal index={3}><div className="card" id="dish-steps" tabIndex={-1}><h3><ChefHat size={20}/>一步一步，让美味发生</h3>{d.steps?.map((s: any, n: number) => <div className="step" key={n}><span>{n + 1}</span><div><strong>{s.title}</strong><StepText text={s.description}/><small>{s.start_minute ?? 0} 分钟开始 · {s.duration_minutes} 分钟{s.temperature_c != null ? ' · ' + s.temperature_c + '℃' : ''} {s.power_level}</small>{s.safety_note && <p className="safety">{s.safety_note}</p>}</div></div>)}{!d.steps?.length && <p className="hint">本次未提供烹饪步骤，请补全后再烹饪。</p>}</div></Reveal></div><Reveal index={4}><Analysis recipe={d}/></Reveal><Reveal index={5}><Sources sources={d.sources} usage={d.token_usage}/></Reveal><Reveal index={6}><ShoppingPreview key={d.id} recipe={d}/></Reveal></div>; }
function RecipePage() { const { id } = useParams(); const q = useQuery<Doc>({ queryKey: ['document', 'recipes', id], queryFn: () => api('/documents/recipes/' + id), refetchInterval: q => q.state.data?.image_status === 'pending' ? 2000 : false }); const r = q.data; if (q.isPending)
    return <p className="page" role="status">正在加载菜谱…</p>; if (q.error)
    return <Notice>{q.error.message}</Notice>; return r ? <RecipeConversation key={'recipe:'+r.id} recipe={r} kind="recipes" assistant>{()=><RecipeView r={r}/>}</RecipeConversation> : <Empty text="菜谱不存在" to="/recipes"/>; }
function Shared() { const { token } = useParams(); const q = useQuery({ queryKey: ['share', token], queryFn: () => api('/share/' + token), refetchInterval: q => q.state.data?.image_status === 'pending' ? 2000 : false }); return <div className="shared">{q.data ? <RecipeView r={q.data} shared/> : <Notice>{q.error?.message || '正在加载分享…'}</Notice>}</div>; }
function DishTags({ tags, shared, save }: {
    tags?: string[];
    shared: boolean;
    save: (tags: string[]) => Promise<void>;
}) { const catalog = useQuery({ queryKey: ['tags'], queryFn: () => api('/tags'), enabled: !shared }), custom = useDocs('tags'); const current = tags?.length ? tags : ['未知']; const options = [...new Set<string>([...(catalog.data?.defaults || []), ...(catalog.data?.global || []).map((t: any) => t.name), ...(custom.data || []).map(t => t.name), ...current])]; return <div className="tag-editor"><div className="chips tag-chips">{current.slice(0, 3).map(t => <span key={t}>{t}</span>)}</div>{(!shared || current.length > 3) && <details><summary>{shared ? '更多标签' : '管理标签'}{current.length > 3 ? ` · 共 ${current.length} 个` : ''}</summary><div className="chips tag-chips">{(shared ? current.slice(3) : options).map(t => shared ? <span key={t}>{t}</span> : <button type="button" key={t} aria-pressed={current.includes(t)} className={current.includes(t) ? 'active' : ''} onClick={() => { const next = current.includes(t) ? current.filter(x => x !== t) : [...current.filter(x => x !== '未知'), t]; void save(next.length ? next : ['未知']); }}>{t}</button>)}</div></details>}</div>; }
function RecipeView({ r, shared = false }: {
    r: Doc;
    shared?: boolean;
}) { const [activeDish, setActiveDish] = useState(() => Math.min(Math.max(0, (r.dishes?.length || 1) - 1), Math.max(0, Number(location.hash.replace('#dish-', '')) || 0))); const nav = useNavigate(); useEffect(() => { if (location.hash)
    document.getElementById(location.hash.slice(1))?.scrollIntoView(); }, [r.id]); const [message, setMessage] = useState(''), [edit, setEdit] = useState(false), [text, setText] = useState(''); const sharing = useRecipeShare({ id: r.id, onMessage: setMessage }); const money = (v: number) => v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(2); async function update(p: any) { try {
    await api('/documents/recipes/' + r.id, 'PUT', { ...r, ...p });
    await Promise.all([client.invalidateQueries({ queryKey: ['docs', 'recipes'] }), client.invalidateQueries({ queryKey: ['docs', 'dishes'] })]);
    await client.invalidateQueries({ queryKey: ['generation-result'] });
    await client.invalidateQueries({ queryKey: ['document'] });
    setMessage('更改已保存');
}
catch (e) {
    setMessage((e as Error).message);
} } return <div className="page recipe-reading"><Link className="back-link" to="/recipes">← 我的食谱</Link><ReadingNav activeDish={activeDish} shared={shared}/><Reveal index={0}><div id="overview" className="recipe-overview"><Title kicker="YOUR PERSONAL MENU" title={r.title} desc={r.summary}/><MenuPhoto dishes={r.dishes}/><ImageProgress status={r.image_status}/></div></Reveal><Reveal index={1}><ColorStatCards label="餐食概况" className="overview-stats" items={[{id:'servings',label:'用餐人数',value:r.servings??'—',unit:'人',icon:Users,tone:'lime'},{id:'time',label:'时间线总耗时',value:r.total_elapsed_minutes??'—',unit:'分钟',icon:Clock,tone:'butter'},{id:'cost',label:'食材消耗成本 · 部分估算',value:money(r.total_cost),unit:'元',icon:ShoppingBasket,tone:'orange'}]}/></Reveal><p className="hint">人均食材成本 ¥{money(r.total_cost / (r.servings || 1))} · 人均热量 {r.nutrition?.calories == null ? '—' : Math.round(r.nutrition.calories / (r.servings || 1))} kcal · 未知价格 {r.unknown_prices || 0} 项（不计入总价）</p>{r.warnings?.length > 0 && <Notice><strong>条件校验提醒：请核对后再烹饪</strong><ul>{r.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul></Notice>}{!shared && <div className="actions wrap"><Button disabled={!r.dishes?.some((d: any) => d.steps?.length)} onClick={() => nav('/cook/' + r.id)}><Play size={17}/>开始烹饪</Button><Button variant="secondary" onClick={() => update({ saved: !r.saved })}>{r.saved ? '取消保存' : '保存菜单'}</Button><Button variant="secondary" onClick={() => update({ favorite: !r.favorite })}><Heart size={16}/>{r.favorite ? '已收藏' : '收藏'}</Button><details className="more-actions" onClick={e => { if ((e.target as HTMLElement).closest('button'))
    e.currentTarget.open = false; }} onKeyDown={e => { if (e.key === 'Escape') {
    e.currentTarget.open = false;
    e.currentTarget.querySelector('summary')?.focus();
} }}><summary className="btn secondary">更多操作</summary><div className="more-actions-list"><Button variant="ghost" onClick={() => { setText(JSON.stringify(r, null, 2)); setEdit(true); }}>编辑 / 新版本</Button><Button variant="secondary" disabled={sharing.busy} onClick={sharing.share}><Share2 size={16}/>{sharing.busy ? '正在分享…' : '分享'}</Button><Button variant="secondary" onClick={async () => { try {
    nav('/generating/' + beginGeneration(r.request));
}
catch (e) {
    setMessage((e as Error).message);
} }}><RotateCcw size={16}/>重新搭配</Button><Button variant="ghost" onClick={async () => { if (confirm('删除这份菜谱？分享链接将同时失效。')) {
    try {
        await api('/documents/recipes/' + r.id, 'DELETE');
        client.invalidateQueries({ queryKey: ['docs', 'recipes'] });
        nav('/recipes');
    }
    catch (e) {
        setMessage((e as Error).message);
    }
} }}><Trash2 size={16}/>删除菜谱</Button></div></details></div>}{sharing.result}<Notice>{message}</Notice>{edit && <div className="card form-stack mt"><h3>编辑完整菜谱 JSON</h3><p>修改食材或步骤后，服务器会重新计算与校验。</p><textarea className="code-editor" value={text} onChange={e => setText(e.target.value)}/><div className="actions"><Button onClick={async () => { try {
    const data = JSON.parse(text);
    await update(data);
    setEdit(false);
}
catch {
    setMessage('JSON 格式错误');
} }}>保存修改</Button><Button variant="secondary" onClick={async () => { try {
    const data = JSON.parse(text);
    const result = await api('/documents/recipes', 'POST', { ...data, parent_id: r.id });
    await Promise.all([client.invalidateQueries({ queryKey: ['docs', 'recipes'] }), client.invalidateQueries({ queryKey: ['docs', 'dishes'] })]);
    setEdit(false);
    nav('/recipes/' + result.id);
}
catch (e) {
    setMessage((e as Error).message);
} }}>保存为新版本</Button><Button variant="ghost" onClick={() => setEdit(false)}>取消</Button></div></div>}<AIUpdateSection section="tags"><DishTags tags={r.tags} shared={shared} save={tags => update({ tags })}/></AIUpdateSection><div className="deck-navigation" aria-label="切换菜品"><button className="btn secondary" disabled={activeDish === 0} onClick={() => setActiveDish(activeDish - 1)}>← 上一道</button><div className="chips">{(r.dishes || []).map((d: any, i: number) => <button key={i} aria-pressed={activeDish === i} className={activeDish === i ? 'active' : ''} onClick={() => setActiveDish(i)}>{i + 1} · {d.name}</button>)}</div><button className="btn secondary" disabled={activeDish >= (r.dishes || []).length - 1} onClick={() => setActiveDish(activeDish + 1)}>下一道 →</button></div><div className="dish-list dish-deck">{(r.dishes || []).map((d: any, index: number) => <article hidden={index !== activeDish} className="dish" id={'dish-' + index} key={index}><AIUpdateSection section="dish-overview" dishIndex={index}><div className="dish-header"><DishPhoto dish={d}/><div><span className="eyebrow">DISH {String(index + 1).padStart(2, '0')}</span><h2>{d.name}</h2><p>{d.description}</p>{!shared && <SaveDish key={r.id + ":" + index + ":" + (d.collection_id || 0)} menuId={r.id} index={index} dish={d}/>}<details className="dish-tag-details"><summary>菜品标签</summary><DishTags tags={d.tags} shared={shared} save={tags => update({ dishes: (r.dishes || []).map((dish: any, i: number) => i === index ? { ...dish, tags } : dish) })}/></details><small>准备 {d.prep_minutes ?? '—'} 分钟 · 烹饪 {d.cook_minutes ?? '—'} 分钟 · ¥{money(d.cost)} · {d.nutrition?.calories == null ? '—' : Math.round(d.nutrition.calories)} kcal</small></div></div></AIUpdateSection><div className="dish-body"><Reveal index={2} dishIndex={index}><div id={"ingredients-" + index}><h3>食材准备</h3><IngredientGroups ingredients={d.ingredients} showCosts/></div></Reveal><Reveal index={3} dishIndex={index}><div id={"steps-" + index}><h3>烹饪步骤</h3>{!d.steps?.length && <p className="hint">烹饪步骤尚未完成，可通过更多操作编辑或重新搭配。</p>}{(d.steps || []).map((s: any, j: number) => <div className="step" key={j}><span>{j + 1}</span><div><strong>{s.title}</strong><StepText text={s.description}/><small>{s.start_minute} 分钟开始 · {s.duration_minutes} 分钟 {s.temperature_c != null ? '· ' + s.temperature_c + '℃' : ''} {s.power_level}</small>{s.safety_note && <p className="safety">{s.safety_note}</p>}</div></div>)}</div></Reveal></div><Reveal index={4} dishIndex={index} anchorId={"dish-insights-" + index}><DishInsights dish={d} shared={shared}/></Reveal></article>)}</div><Reveal index={4}><Analysis recipe={r} shared={shared}/></Reveal><Reveal index={5}><Sources sources={r.sources} usage={r.token_usage}/></Reveal>{!shared && <><Reveal index={6}><ShoppingPreview key={r.id} recipe={r}/></Reveal><form className="card form-stack mt" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); await update({ rating: Number(f.get('rating')), feedback: f.get('feedback') }); setMessage('反馈已保存，将让我下次更懂你的口味'); }}><h3>这顿饭，合口味吗？</h3><Field label="评分"><select name="rating" defaultValue={r.rating || 5}>{[1, 2, 3, 4, 5].map(n => <option value={n} key={n}>{n} 星</option>)}</select></Field><Field label="反馈"><textarea name="feedback" defaultValue={r.feedback} placeholder="太咸、太油、步骤复杂，或者非常喜欢…"/></Field><Button variant="secondary">保存反馈</Button></form></>}</div>; }
function Cooking({ single = false }: {
    single?: boolean;
}) { const { id } = useParams(); const q = useDocs(single ? 'dishes' : 'recipes'), eq = useDocs('equipment'); const doc = q.data?.find(r => r.id === Number(id)); const r = useMemo(() => single && doc ? { ...doc, dishes: [doc] } : doc, [single, doc]); const steps = r?.dishes?.flatMap((d: any) => (d.steps || []).map((s: any) => ({ ...s, dish: d }))).sort((a: any, b: any) => a.start_minute - b.start_minute) || []; const key = (single ? 'cooking-dish:' : 'cooking:') + id; const [index, setIndex] = useState(() => Number(localStorage.getItem(key) || 0)), [left, setLeft] = useState(0), [running, setRunning] = useState(false), [done, setDone] = useState<number[]>([]), [message, setMessage] = useState(''); useEffect(() => { localStorage.setItem(key, String(index)); setRunning(false); setLeft((steps[index]?.duration_minutes || 0) * 60); }, [index, r]); useEffect(() => { if (!running)
    return; const end = Date.now() + left * 1000; const timer = setInterval(() => { const n = Math.max(0, Math.ceil((end - Date.now()) / 1000)); setLeft(n); if (n === 0)
    setRunning(false); }, 250); return () => clearInterval(timer); }, [running]); const s = steps[index]; if (!r || !s)
    return <Empty text="没有可烹饪的步骤" to="/recipes"/>; return <div className="page cooking"><Link to={(single ? '/dishes/' : '/recipes/') + id}>← 暂停并退出做饭模式</Link><span className="eyebrow">COOK WITH CONFIDENCE</span><h1>{s.dish.name}</h1><div className="step-progress">{steps.map((_: any, i: number) => <button aria-label={'步骤 ' + (i + 1)} onClick={() => setIndex(i)} className={i === index ? 'current' : done.includes(i) ? 'done' : ''} key={i}/>)}</div><div className="card cook-card"><p className="eyebrow">STEP {index + 1} / {steps.length} · 时间线第 {s.start_minute} 分钟</p><h2>{s.title}</h2><p className="cook-description">{s.description}</p><div className="chips">{s.dish.ingredients.map((i: any, j: number) => <span key={j}>{i.name} {i.quantity}{i.unit}</span>)}</div><p>炊具：{eq.data?.find(e => e.id === s.equipment_id)?.name || '备料 / 无需炊具'} {s.temperature_c != null ? ' · ' + s.temperature_c + '℃' : ''} {s.power_level}</p>{s.safety_note && <Notice>{s.safety_note}</Notice>}<div className="timer">{String(Math.floor(left / 60)).padStart(2, '0')}:{String(left % 60).padStart(2, '0')}</div><div className="actions center"><Button variant="secondary" onClick={() => setRunning(!running)}>{running ? <Pause size={18}/> : <Play size={18}/>} {running ? '暂停' : '开始计时'}</Button><Button variant="ghost" onClick={() => { setRunning(false); setLeft(s.duration_minutes * 60); }}>重置</Button><Button variant="secondary" onClick={() => setDone([...new Set([...done, index])])}><Check size={17}/>{done.includes(index) ? '已完成' : '标记完成'}</Button></div><div className="actions spread mt"><Button variant="secondary" disabled={index === 0} onClick={() => setIndex(index - 1)}>上一步</Button>{index < steps.length - 1 ? <Button onClick={() => setIndex(index + 1)}>下一步 <ArrowRight size={17}/></Button> : <Button onClick={async () => { try {
    if (single) {
        setMessage('完成！这道菜已经做好了。');
        localStorage.removeItem(key);
        return;
    }
    await api('/documents/history', 'POST', { recipe_id: r.id, finished_at: new Date().toISOString() });
    client.invalidateQueries({ queryKey: ['docs', 'history'] });
    setMessage('完成！这顿饭已记入烹饪历史。');
    localStorage.removeItem(key);
}
catch (e) {
    setMessage((e as Error).message);
} }}>完成这顿饭</Button>}</div><Notice>{message}</Notice></div></div>; }
function Shopping() { const q = useDocs('shopping'); const [message, setMessage] = useState(''); async function save(list: Doc) { try {
    await api('/documents/shopping/' + list.id, 'PUT', list);
    client.invalidateQueries({ queryKey: ['docs', 'shopping'] });
}
catch (e) {
    setMessage((e as Error).message);
} } return <div className="page narrow"><Title kicker="SHOPPING LIST" title="带着清单，去买点新鲜" desc="相同食材按兼容单位合并，勾选后自动保存。"/><Button onClick={async () => { try {
    await api('/documents/shopping', 'POST', { name: '我的购物清单', items: [] });
    client.invalidateQueries({ queryKey: ['docs', 'shopping'] });
}
catch (e) {
    setMessage((e as Error).message);
} }}><Plus size={17}/>新建清单</Button><Notice>{message}</Notice>{q.data?.length ? q.data.map(list => <div className="card mt" key={list.id}><div className="section-heading"><h2>{list.name}</h2><Button variant="ghost" onClick={async () => { try {
    if (!confirm('删除清单？'))
        return;
    await api('/documents/shopping/' + list.id, 'DELETE');
    client.invalidateQueries({ queryKey: ['docs', 'shopping'] });
}
catch (e) {
    setMessage((e as Error).message);
} }}><Trash2 size={17}/></Button></div>{list.items?.map((i: any, j: number) => <label className={'shopping-item ' + (i.checked ? 'checked' : '')} key={j}><input type="checkbox" checked={i.checked} onChange={() => save({ ...list, items: list.items.map((x: any, k: number) => k === j ? { ...x, checked: !x.checked } : x) })}/><span>{i.name}</span><strong>{i.quantity} {i.unit}</strong></label>)}<form className="input-row mt" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); save({ ...list, items: [...list.items, { name: f.get('name'), quantity: Number(f.get('quantity')), unit: f.get('unit'), checked: false }] }); e.currentTarget.reset(); }}><input name="name" placeholder="补充食材" required/><input name="quantity" type="number" min="0.01" step="any" placeholder="数量" required/><input name="unit" placeholder="单位" required/><Button variant="secondary"><Plus size={16}/></Button></form><Button className="mt" variant="secondary" onClick={async () => { try {
    await navigator.clipboard.writeText(list.items.map((i: any) => `${i.checked ? '☑' : '☐'} ${i.name} ${i.quantity} ${i.unit}`).join('\n'));
    setMessage('清单已复制');
}
catch {
    setMessage('浏览器不支持复制，请手动选择清单文字');
} }}>复制清单</Button></div>) : <Empty text="购物清单还是空的" to="/recipes"/>}</div>; }
function Admin() { const users = useQuery({ queryKey: ['users'], queryFn: () => api('/admin/users') }); const caps = useQuery({ queryKey: ['capabilities'], queryFn: () => api('/capabilities') }); const tags = useQuery({ queryKey: ['tags'], queryFn: () => api('/tags') }); const [message, setMessage] = useState(''); return <div className="page narrow"><Title kicker="ADMINISTRATION" title="一起，把厨房打理好" desc="管理系统全局提示词、注册开关、全局饮食标签和用户。"/><Notice>{message || users.error?.message}</Notice><form className="card form-stack" key={JSON.stringify([caps.data, tags.data])} onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); try {
    await api('/admin/registration', 'PUT', { enabled: f.get('enabled') === 'on', tags: split(String(f.get('tags'))) });
    client.invalidateQueries({ queryKey: ['capabilities'] });
    client.invalidateQueries({ queryKey: ['tags'] });
    setMessage('已保存');
}
catch (e) {
    setMessage((e as Error).message);
} }}><label className="check-row"><input name="enabled" type="checkbox" defaultChecked={caps.data?.registration}/>允许新用户注册</label><Field label="新增全局标签（逗号分隔；默认标签始终保留）"><textarea name="tags" defaultValue={tags.data?.global?.map((t: any) => t.name).join('，')}/></Field><Button>保存</Button></form><SystemGlobalPrompt /><AdminGenerations users={users.data || []}/><div className="card mt"><h2>用户管理</h2>{users.data?.map((u: any) => <div className="shopping-item" key={u.id}><span>{u.username} {u.admin ? '· 管理员' : ''}</span>{!u.admin && <Button variant="ghost" onClick={async () => { if (confirm('删除用户及全部关联数据？此操作不可恢复。')) {
    try {
        await api('/admin/users/' + u.id, 'DELETE');
        client.invalidateQueries({ queryKey: ['users'] });
    }
    catch (e) {
        setMessage((e as Error).message);
    }
} }}>删除用户</Button>}</div>)}</div></div>; }
const appRoot = import.meta.hot?.data.root ?? createRoot(document.getElementById('root')!);
if (import.meta.hot) import.meta.hot.data.root = appRoot;
appRoot.render(<React.StrictMode><QueryClientProvider client={client}><BrowserRouter><App /></BrowserRouter></QueryClientProvider></React.StrictMode>);
