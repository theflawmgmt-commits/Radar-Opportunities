import { createContext, useContext, type ReactNode, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';
import {
  Archive, ArchiveRestore, ArrowDown, ArrowLeft, ArrowUpRight, Bookmark, Check, ChevronDown, CircleHelp,
  Compass, Copy, Edit3, ExternalLink, FileText, Filter, Gauge, Globe2, Instagram, Layers3,
  Linkedin, Mail, Menu, MoreHorizontal, Phone, Plus, Radar as RadarIcon, RefreshCw, Search,
  Send, Settings2, ShieldCheck, Sparkles, Target, UserRound, Users, X, Zap,
} from 'lucide-react';
import {
  getGetDashboardQueryKey, getGetLeadQueryKey, getGetPipelineQueryKey, getListActivityQueryKey,
  getListLeadsQueryKey, getListOutreachQueryKey, getListRadarsQueryKey, getGetRadarQueryKey,
  useCreateOutreach, useCreateRadar, useGetDashboard, useGetLead, useGetPipeline, useListActivity,
  useListLeads, useListOutreach, useListRadars, useRunRadar, useUpdateLead, useUpdateOutreach,
  useUpdatePipelineStage, useUpdateRadar,
} from '@workspace/api-client-react';
import type { Lead, Outreach, Radar } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import NotFound from '@/pages/not-found';

type ExecutionMode = 'demo' | 'live';
const ExecutionModeContext = createContext<{
  mode: ExecutionMode;
  setMode: (m: ExecutionMode) => void;
}>({ mode: 'demo', setMode: () => {} });
function useExecutionMode() {
  return useContext(ExecutionModeContext);
}

const queryClient = new QueryClient();
const navItems = [
  { href: '/', label: 'Command center', icon: Gauge },
  { href: '/discover', label: 'Discover', icon: Compass },
  { href: '/outreach', label: 'Outreach', icon: Send },
  { href: '/pipeline', label: 'Pipeline', icon: Layers3 },
  { href: '/radars', label: 'Saved Radars', icon: RadarIcon },
];
const stageLabels = [
  'discovered',
  'review',
  'shortlisted',
  'outreach_ready',
  'contacted',
  'replied',
  'won',
  'lost',
  'archived',
] as const;

function cx(...classes: Array<string | false | undefined>) { return classes.filter(Boolean).join(' '); }
function formatDate(value?: string) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(value));
}
function sourceLabel(status?: string) {
  return status === 'demo' ? 'DEMO EVIDENCE' : status === 'connected' ? 'LIVE VERIFIED' : 'NOT VERIFIED';
}

function Shell({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { mode, setMode } = useExecutionMode();
  return (
    <div className="min-h-[100dvh] bg-background md:flex">
      <aside className={cx('fixed inset-y-0 left-0 z-40 flex w-[252px] flex-col bg-[hsl(var(--sidebar))] px-5 py-6 text-[hsl(var(--sidebar-foreground))] transition-transform md:static md:translate-x-0', mobileOpen ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex items-center justify-between">
          <Link href="/" data-testid="link-brand" className="flex items-center gap-3 text-[hsl(var(--sidebar-foreground))]">
            <span className="grid size-9 place-items-center rounded-full bg-[hsl(var(--sidebar-primary))] text-[hsl(var(--sidebar-primary-foreground))]"><RadarIcon size={18} strokeWidth={2.5} /></span>
            <span className="text-xl font-semibold tracking-[-.04em]">RADAR</span>
          </Link>
          <button className="md:hidden" onClick={() => setMobileOpen(false)} data-testid="button-close-menu"><X size={18} /></button>
        </div>
        <div className="mt-10 px-2 text-[10px] font-mono-radar uppercase tracking-[.19em] text-[hsl(var(--sidebar-foreground)/.48)]">Workspace</div>
        <nav className="mt-3 space-y-1">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={() => setMobileOpen(false)} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`} className={cx('group flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors', location === href ? 'bg-[hsl(var(--sidebar-accent))] text-[hsl(var(--sidebar-foreground))]' : 'text-[hsl(var(--sidebar-foreground)/.64)] hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-foreground))]')}>
              <Icon size={16} className={location === href ? 'text-[hsl(var(--sidebar-primary))]' : ''} /><span>{label}</span>{href === '/discover' && <span className={cx("ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-bold", mode === 'live' ? "bg-emerald-600 text-white" : "bg-[hsl(var(--sidebar-primary))] text-[hsl(var(--sidebar-primary-foreground))]")}>{mode === 'live' ? 'LIVE' : 'DEMO'}</span>}
            </Link>
          ))}
        </nav>
        <div className="mt-auto">
          <div className="mb-3 rounded-lg border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-accent)/.66)] p-3">
            <div className="flex items-center gap-2 text-[10px] font-mono-radar uppercase tracking-[.15em] text-[hsl(var(--sidebar-primary))]">
              <span className={cx("size-1.5 rounded-full", mode === 'live' ? "bg-emerald-400" : "bg-[hsl(var(--sidebar-primary))] soft-pulse")} />
              {mode === 'live' ? 'Live discovery' : 'Demo mode'}
            </div>
            <p className="mt-2 text-xs leading-5 text-[hsl(var(--sidebar-foreground)/.63)]">
              {mode === 'live'
                ? 'Queries Firecrawl for real company research. Nothing sends without your approval.'
                : 'Every company and source is fictional. Nothing sends without your approval.'}
            </p>
          </div>
          <Link href="/settings" data-testid="link-settings" className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-[hsl(var(--sidebar-foreground)/.64)] hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-foreground))]"><Settings2 size={16} /> Settings</Link>
          <div className="mt-5 border-t border-[hsl(var(--sidebar-border))] pt-4"><div className="flex items-center gap-3"><div className="grid size-8 place-items-center rounded-full bg-[hsl(var(--sidebar-primary)/.18)] text-xs font-semibold text-[hsl(var(--sidebar-primary))]">MC</div><div><p className="text-xs font-semibold">Maya Chen</p><p className="text-[10px] text-[hsl(var(--sidebar-foreground)/.48)]">Solo studio</p></div><MoreHorizontal size={16} className="ml-auto text-[hsl(var(--sidebar-foreground)/.4)]" /></div></div>
        </div>
      </aside>
      {mobileOpen && <button aria-label="Close menu" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-30 bg-[hsl(var(--foreground)/.25)] md:hidden" data-testid="button-dismiss-menu" />}
      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-border bg-background/95 px-5 backdrop-blur-sm md:px-10">
          <button className="md:hidden" onClick={() => setMobileOpen(true)} data-testid="button-open-menu"><Menu size={20} /></button>
          <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex"><span className="font-mono-radar text-[10px] uppercase tracking-[.13em]">Morning brief</span><span className="size-1 rounded-full bg-[hsl(var(--accent))]" /><span>{new Intl.DateTimeFormat('en', { weekday: 'long', month: 'short', day: 'numeric' }).format(new Date())}</span></div>
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center rounded-full border border-border bg-muted/60 p-0.5 text-[10px] font-mono-radar" data-testid="container-mode-toggle">
              <button
                type="button"
                onClick={() => setMode('demo')}
                className={cx('rounded-full px-2.5 py-1 font-semibold transition-colors', mode === 'demo' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
                data-testid="button-toggle-mode-demo"
              >
                DEMO
              </button>
              <button
                type="button"
                onClick={() => setMode('live')}
                className={cx('rounded-full px-2.5 py-1 font-semibold transition-colors', mode === 'live' ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-sm' : 'text-muted-foreground hover:text-foreground')}
                data-testid="button-toggle-mode-live"
              >
                LIVE
              </button>
            </div>
            <span className="hidden rounded-full border border-border px-2.5 py-1 text-[10px] font-mono-radar uppercase tracking-[.12em] text-muted-foreground sm:inline-flex">
              <span className={cx('mr-1.5 mt-0.5 size-1.5 rounded-full', mode === 'live' ? 'bg-emerald-500' : 'bg-[hsl(var(--accent))]')} />
              {mode === 'live' ? 'Live data' : 'Fictional data'}
            </span>
            <Link href="/create" data-testid="link-header-create" className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5"><Plus size={14} /> New Radar</Link>
          </div>
        </header>
        <div className="mx-auto max-w-[1440px] px-5 py-8 md:px-10 md:py-11">{children}</div>
      </main>
    </div>
  );
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-9 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><div className="mb-3 flex items-center gap-2 text-[10px] font-mono-radar uppercase tracking-[.2em] text-[hsl(var(--primary))]"><span className="size-1.5 rounded-full bg-[hsl(var(--accent))]" />{eyebrow}</div><h1 className="font-display text-5xl leading-[.95] tracking-[-.04em] md:text-6xl">{title}</h1>{description && <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>}</div>{action}</div>;
}
function Stat({ label, value, detail, accent = false }: { label: string; value: number | string; detail?: string; accent?: boolean }) {
  return <div className={cx('border-l px-5 py-1 first:pl-0', accent ? 'border-[hsl(var(--accent))]' : 'border-border')}><div className="text-[10px] font-mono-radar uppercase tracking-[.14em] text-muted-foreground">{label}</div><div className="mt-2 text-3xl font-semibold tracking-[-.05em]">{value}</div>{detail && <div className="mt-1 text-xs text-muted-foreground">{detail}</div>}</div>;
}
function LoadingRows({ count = 3 }: { count?: number }) { return <div className="space-y-3">{Array.from({ length: count }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />)}</div>; }
function ErrorState({ onRetry }: { onRetry: () => void }) { return <div className="border border-destructive/30 bg-destructive/5 p-8 text-center"><p className="font-semibold">The brief went quiet.</p><p className="mt-1 text-sm text-muted-foreground">We couldn't load this view. Try again.</p><button onClick={onRetry} data-testid="button-retry" className="mt-4 inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold hover:bg-muted"><RefreshCw size={14} /> Retry</button></div>; }
function EmptyState({ title, detail, href, action }: { title: string; detail: string; href?: string; action?: string }) { return <div className="paper-grid border border-dashed border-border px-6 py-16 text-center"><div className="mx-auto grid size-11 place-items-center rounded-full border border-border bg-card text-muted-foreground"><Target size={18} /></div><h3 className="mt-4 font-display text-2xl">{title}</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{detail}</p>{href && <Link href={href} data-testid="link-empty-action" className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground">{action ?? 'Get started'} <ArrowUpRight size={14} /></Link>}</div>; }

function Home() {
  const dashboard = useGetDashboard();
  const activity = useListActivity();
  if (dashboard.isLoading) return <PageFrame><PageHeader eyebrow="Command center" title="A sharper morning." description="Loading your opportunity brief…" /><LoadingRows count={4} /></PageFrame>;
  if (dashboard.isError) return <PageFrame><ErrorState onRetry={() => dashboard.refetch()} /></PageFrame>;
  const data = dashboard.data;
  return <PageFrame><PageHeader eyebrow="Command center" title={data?.activeRadar ? `Good morning, Maya.` : 'Start with a signal.'} description={data?.activeRadar ? `Your ${data.activeRadar.name} Radar has fresh movement. Here is what deserves your attention today.` : 'Tell RADAR what you sell and who you want to help. We’ll turn that into a focused, evidence-led brief.'} action={<Link href={data?.activeRadar ? '/discover' : '/create'} data-testid="link-home-primary" className="group inline-flex items-center gap-2 rounded-md bg-primary px-4 py-3 text-xs font-semibold text-primary-foreground">{data?.activeRadar ? 'Open opportunities' : 'Create your first Radar'} <ArrowUpRight size={15} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" /></Link>} />
    <div className="grid gap-8 lg:grid-cols-[1.35fr_.65fr]">
      <section className="border-y border-border py-6"><div className="mb-7 flex items-center justify-between"><div><div className="text-[10px] font-mono-radar uppercase tracking-[.16em] text-muted-foreground">Today at a glance</div><p className="mt-2 text-sm text-muted-foreground">The few numbers worth carrying into the day.</p></div><span className="rounded-full bg-[hsl(var(--accent)/.2)] px-2 py-1 text-[10px] font-mono-radar uppercase text-[hsl(var(--foreground))]">Demo mode</span></div><div className="grid grid-cols-2 gap-y-7 md:grid-cols-4"><Stat label="New opportunities" value={data?.newOpportunities ?? 0} detail="Since last run" accent /><Stat label="Needs attention" value={data?.needsAttention ?? 0} detail="Worth a closer look" /><Stat label="Outreach ready" value={data?.outreachReady ?? 0} detail="Drafts to review" /><Stat label="Total leads" value={data?.totalLeads ?? 0} detail="Across your Radars" /></div></section>
      <section className="rounded-lg bg-[hsl(var(--primary))] p-6 text-[hsl(var(--primary-foreground))]"><div className="flex items-center justify-between"><span className="text-[10px] font-mono-radar uppercase tracking-[.16em] text-[hsl(var(--primary-foreground)/.64)]">Active Radar</span><RadarIcon size={19} className="text-[hsl(var(--accent))]" /></div>{data?.activeRadar ? <><h2 className="mt-8 font-display text-3xl">{data.activeRadar.name}</h2><p className="mt-2 text-sm leading-6 text-[hsl(var(--primary-foreground)/.68)]">{data.activeRadar.description}</p><div className="mt-7 flex items-center justify-between border-t border-[hsl(var(--primary-foreground)/.17)] pt-4 text-xs"><span>{data.activeRadar.leadCount} leads found</span><Link href="/radars" data-testid="link-home-radars" className="underline underline-offset-4">Tune Radar</Link></div></> : <><h2 className="mt-8 font-display text-3xl">No signal yet.</h2><p className="mt-2 text-sm leading-6 text-[hsl(var(--primary-foreground)/.68)]">A clear brief makes better leads. Give your first Radar a target, an offer, and a few sharp edges.</p><Link href="/create" data-testid="link-home-create-card" className="mt-7 inline-flex items-center gap-2 text-xs font-semibold underline underline-offset-4">Set up a Radar <ArrowUpRight size={14} /></Link></>}</section>
    </div>
    <section className="mt-12"><div className="mb-5 flex items-end justify-between"><div><div className="text-[10px] font-mono-radar uppercase tracking-[.16em] text-muted-foreground">Recent movement</div><h2 className="mt-2 font-display text-3xl">What changed</h2></div><Link href="/discover" data-testid="link-home-discover" className="text-xs font-semibold text-[hsl(var(--primary))] underline underline-offset-4">View all signals</Link></div>{activity.isLoading ? <LoadingRows count={3} /> : activity.isError ? <ErrorState onRetry={() => activity.refetch()} /> : activity.data?.length ? <div className="divide-y border-y border-border">{activity.data.slice(0, 5).map(item => <Link href={`/leads/${item.leadId}`} key={item.id} data-testid={`link-activity-${item.id}`} className="group flex items-center gap-4 py-4 transition-colors hover:bg-[hsl(var(--accent)/.08)]"><div className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-[hsl(var(--primary))]">{item.type === 'research' ? <FileText size={15} /> : item.type === 'follow_up' ? <Send size={15} /> : <Sparkles size={15} />}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{item.title}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.detail}</p></div><time className="shrink-0 text-[10px] font-mono-radar text-muted-foreground">{formatDate(item.createdAt)}</time><ArrowUpRight size={15} className="text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></Link>)}</div> : <EmptyState title="No movement yet" detail="Run your first Radar to start collecting useful signals." href="/create" action="Build a Radar" />}</section>
  </PageFrame>;
}

function PageFrame({ children }: { children: ReactNode }) { return <>{children}</>; }

function Create() {
  const [, setLocation] = useLocation(); const { toast } = useToast(); const qc = useQueryClient();
  const { mode } = useExecutionMode();
  const create = useCreateRadar(); const run = useRunRadar();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    name: '',
    target: '',
    offer: '',
    description: '',
    criteria: '',
    geography: '',
    intent: '',
  });
  const criteria = form.criteria.split('\n').map(s => s.trim()).filter(Boolean);
  const canContinue = step === 1 ? form.name && form.target : form.offer;
  const submit = () => create.mutate({
    data: {
      ...form,
      criteria,
      geography: form.geography ? form.geography.trim() : undefined,
      intent: form.intent ? form.intent.trim() : undefined,
    }
  }, {
    onSuccess: (radar) => {
      qc.invalidateQueries({ queryKey: getListRadarsQueryKey() });
      toast({ title: 'Radar saved', description: `Brief saved. Running in ${mode.toUpperCase()} mode.` });
      run.mutate({ radarId: radar.id, data: { mode } }, {
        onSuccess: (result) => {
          toast({
            title: 'Radar complete',
            description: mode === 'live'
              ? `${result.leadsFound} verified live opportunities found.`
              : `${result.leadsFound} demo opportunities found.`,
          });
          setLocation('/discover');
        },
        onError: (err: any) => {
          const detail = err?.response?.data?.error || err?.message || 'Radar execution failed.';
          toast({
            title: 'Radar execution failed',
            description: detail,
            variant: 'destructive',
          });
          setLocation('/radars');
        },
      });
    },
    onError: () => toast({ title: 'Could not save Radar', description: 'Check the fields and try again.' }),
  });
  return <PageFrame><div className="mx-auto max-w-3xl"><Link href="/" data-testid="link-create-back" className="mb-10 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft size={14} /> Back to command center</Link><div className="mb-12"><div className="mb-4 flex items-center gap-2 text-[10px] font-mono-radar uppercase tracking-[.2em] text-[hsl(var(--primary))]"><span>New Radar</span><span className="text-muted-foreground">/</span><span className="text-muted-foreground">Step {step} of 2</span></div><h1 className="font-display text-6xl leading-[.9] tracking-[-.04em]">Make the ask<br /><em className="text-[hsl(var(--primary))]">specific.</em></h1><p className="mt-5 max-w-lg text-sm leading-6 text-muted-foreground">RADAR works best with a point of view. No jargon needed — just tell us who you can help and what you can do for them.</p></div><div className="mb-10 h-1 w-full bg-muted"><div className="h-full bg-[hsl(var(--accent))] transition-all" style={{ width: step === 1 ? '50%' : '100%' }} /></div>{step === 1 ? <div className="space-y-7 rise-in"><Field label="Name your Radar" hint="A short name you’ll recognize later."><input autoFocus value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Independent shops in Portland" data-testid="input-radar-name" className="radar-input" /></Field><Field label="Who are you looking for?" hint="Describe the kind of company, person, or team you want to find."><textarea value={form.target} onChange={e => setForm({ ...form, target: e.target.value })} placeholder="Small hospitality brands with a strong local following…" data-testid="input-radar-target" className="radar-input min-h-28 resize-none" /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Geography / Region" hint="Optional. Focus discovery geographically."><input value={form.geography} onChange={e => setForm({ ...form, geography: e.target.value })} placeholder="e.g. India, United Kingdom, West Coast" data-testid="input-radar-geography" className="radar-input" /></Field><Field label="Search Intent & Focus" hint="Optional. Strategic qualification lens."><input value={form.intent} onChange={e => setForm({ ...form, intent: e.target.value })} placeholder="e.g. DTC brands with active ecommerce store" data-testid="input-radar-intent" className="radar-input" /></Field></div><Field label="A little more context" hint="Optional. What makes a good fit?"><textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="I’m especially interested in teams who are growing but don't have a dedicated creative lead." data-testid="input-radar-description" className="radar-input min-h-24 resize-none" /></Field></div> : <div className="space-y-7 rise-in"><Field label="What can you offer?" hint="This becomes the starting point for personalized outreach."><textarea autoFocus value={form.offer} onChange={e => setForm({ ...form, offer: e.target.value })} placeholder="Brand identity and launch systems for small teams…" data-testid="input-radar-offer" className="radar-input min-h-32 resize-none" /></Field><Field label="What should count as a signal?" hint="One per line. RADAR uses these as a lens, not a verdict."><textarea value={form.criteria} onChange={e => setForm({ ...form, criteria: e.target.value })} placeholder={'Recently launched or rebranded\nHiring for marketing or design\nActive community presence'} data-testid="input-radar-criteria" className="radar-input min-h-32 resize-none" /></Field><div className="flex gap-3 border border-border bg-card p-4 text-xs leading-5 text-muted-foreground"><CircleHelp size={16} className="mt-0.5 shrink-0 text-[hsl(var(--primary))]" />Live mode uses Firecrawl for real company research and observable signals. Nothing is sent without your approval.</div></div>}<div className="mt-10 flex items-center justify-between">{step === 2 ? <button onClick={() => setStep(1)} data-testid="button-create-previous" className="text-xs font-semibold text-muted-foreground hover:text-foreground">Previous</button> : <span />}{step === 1 ? <button disabled={!canContinue} onClick={() => setStep(2)} data-testid="button-create-next" className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40">Continue <ArrowUpRight size={14} /></button> : <button disabled={!canContinue || create.isPending} onClick={submit} data-testid="button-create-submit" className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40">{create.isPending || run.isPending ? 'Building brief…' : 'Save & run Radar'} <Zap size={14} /></button>}</div></div></PageFrame>;
}
function Field({ label, hint, children }: { label: string; hint: string; children: ReactNode }) { return <label className="block"><span className="text-sm font-semibold">{label}</span><span className="mt-1 block text-xs text-muted-foreground">{hint}</span><div className="mt-3">{children}</div></label>; }

function Discover() {
  const [search, setSearch] = useState(''); const [savedOnly, setSavedOnly] = useState(false); const [, setLocation] = useLocation(); const { toast } = useToast(); const qc = useQueryClient();
  const { mode } = useExecutionMode();
  const leads = useListLeads({ search: search || undefined, mode }); const update = useUpdateLead();
  const filtered = useMemo(() => (leads.data ?? []).filter(l => !savedOnly || l.saved), [leads.data, savedOnly]);
  const toggleSaved = (lead: Lead) => update.mutate({ leadId: lead.id, data: { saved: !lead.saved } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListLeadsQueryKey({ search: search || undefined, mode }) }); toast({ title: lead.saved ? 'Removed from saved' : 'Opportunity saved' }); } });
  return <PageFrame><PageHeader eyebrow={mode === 'live' ? "Opportunity desk (Live)" : "Opportunity desk (Demo)"} title="Find the opening." description={mode === 'live' ? "Specific companies and verified web signals discovered live with Firecrawl. URLs link out directly to source websites." : "Specific companies, visible signals, and the evidence behind each suggestion. Fictional demo brief."} action={<Link href="/create" data-testid="link-discover-new-radar" className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2.5 text-xs font-semibold hover:bg-muted"><Plus size={14} /> New Radar</Link>} /><div className="mb-7 flex flex-col gap-3 border-y border-border py-4 md:flex-row"><div className="relative flex-1"><Search size={16} className="absolute left-3 top-3 text-muted-foreground" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search companies, industries, places…" data-testid="input-discover-search" className="radar-input h-10 pl-9" /></div><button onClick={() => setSavedOnly(!savedOnly)} data-testid="button-filter-saved" className={cx('inline-flex h-10 items-center justify-center gap-2 rounded-md border px-3 text-xs font-semibold', savedOnly ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/.08)] text-[hsl(var(--primary))]' : 'border-border bg-card')}><Bookmark size={14} className={savedOnly ? 'fill-current' : ''} /> Saved only</button><button data-testid="button-filter-menu" className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-card px-3 text-xs font-semibold hover:bg-muted"><Filter size={14} /> Filters <ChevronDown size={13} /></button></div>{leads.isLoading ? <LoadingRows count={5} /> : leads.isError ? <ErrorState onRetry={() => leads.refetch()} /> : filtered.length ? <div className="space-y-3">{filtered.map((lead, i) => <LeadRow key={lead.id} lead={lead} index={i} onSave={() => toggleSaved(lead)} onOpen={() => setLocation(`/leads/${lead.id}`)} />)}</div> : <EmptyState title={savedOnly ? 'No saved opportunities' : (mode === 'live' ? 'No live opportunities yet' : 'No opportunities yet')} detail={savedOnly ? 'Save a lead when you see a real opening.' : (mode === 'live' ? 'Run a Radar in Live Mode to discover companies using Firecrawl.' : 'Run a Radar to find companies that fit your brief.')} href={savedOnly ? undefined : '/create'} action={mode === 'live' ? "Run a Live Radar" : "Create a Radar"} />}</PageFrame>;
}
function LeadRow({ lead, index, onSave, onOpen }: { lead: Lead; index: number; onSave: () => void; onOpen: () => void }) {
  const brief = lead.opportunityBrief;
  const whyRelevantText = brief?.whyRelevant?.[0] || lead.description;
  const opportunityText = brief?.opportunity?.hypothesis || lead.opportunity?.[0] || lead.signals?.[0];
  const contactState = brief?.contactEvidence?.status ?? (lead.contactVerified ? 'VERIFIED_DIRECT' : lead.contactPoints?.length ? 'COMPANY_ONLY' : 'ABSENT');

  return (
    <div
      className="group grid gap-4 border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-[hsl(var(--primary)/.45)] hover:shadow-[0_8px_24px_hsl(var(--foreground)/.06)] md:grid-cols-[1.1fr_1.4fr_auto] md:items-center"
      style={{ animationDelay: `${index * 35}ms` }}
      data-testid={`card-lead-${lead.id}`}
    >
      <div className="min-w-0">
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-[hsl(var(--primary)/.1)] text-xs font-semibold text-[hsl(var(--primary))]">
            {lead.companyName.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{lead.companyName}</h3>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {lead.industry} · {lead.location}
            </p>
            {lead.website && (
              <a
                href={lead.website}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-[hsl(var(--primary))]"
              >
                <Globe2 size={11} /> {lead.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              </a>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {lead.signals.slice(0, 2).map((signal) => (
            <span key={signal} className="rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              {signal}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-2 border-t border-border pt-3 md:border-t-0 md:pt-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="rounded bg-muted px-2 py-0.5 text-[9px] font-mono-radar uppercase font-semibold text-muted-foreground">
              {lead.status.replace('_', ' ')}
            </span>
            {lead.fit && (
              <span
                className={cx(
                  "rounded px-2 py-0.5 text-[9px] font-mono-radar uppercase font-bold",
                  lead.fit === 'HIGH RELEVANCE'
                    ? 'bg-emerald-100 text-emerald-800'
                    : lead.fit === 'POSSIBLE RELEVANCE'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {lead.fit}
              </span>
            )}
            <span className="text-xs font-semibold text-[hsl(var(--primary))] font-mono-radar">
              {lead.relevance}/100
            </span>
          </div>

          <div>
            {contactState === 'VERIFIED_DIRECT' ? (
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-[9px] font-mono-radar uppercase font-bold text-emerald-800">
                Direct Contact Verified
              </span>
            ) : contactState === 'SUPPORTED_DIRECT' ? (
              <span className="rounded bg-amber-100 px-2 py-0.5 text-[9px] font-mono-radar uppercase font-bold text-amber-800">
                Direct Contact Supported
              </span>
            ) : contactState === 'COMPANY_ONLY' ? (
              <span className="rounded bg-muted px-2 py-0.5 text-[9px] font-mono-radar uppercase font-medium text-muted-foreground">
                Company Contact Only
              </span>
            ) : (
              <span className="rounded bg-muted px-2 py-0.5 text-[9px] font-mono-radar uppercase text-muted-foreground">
                No Contact Observed
              </span>
            )}
          </div>
        </div>

        <div>
          <span className="text-[10px] font-mono-radar uppercase tracking-[.08em] text-muted-foreground">Why relevant:</span>
          <p className="line-clamp-1 text-xs text-foreground font-medium">{whyRelevantText}</p>
        </div>

        <div>
          <span className="text-[10px] font-mono-radar uppercase tracking-[.08em] text-muted-foreground">Opportunity:</span>
          <p className="line-clamp-1 text-xs text-muted-foreground">{opportunityText}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 md:flex-col md:items-end">
        <button
          onClick={onSave}
          aria-label={lead.saved ? 'Remove saved lead' : 'Save lead'}
          data-testid={`button-save-lead-${lead.id}`}
          className={cx(
            'grid size-9 place-items-center rounded-md border border-border transition-colors hover:border-[hsl(var(--primary))]',
            lead.saved ? 'bg-[hsl(var(--accent)/.24)] text-[hsl(var(--primary))]' : 'bg-background text-muted-foreground',
          )}
        >
          <Bookmark size={15} className={lead.saved ? 'fill-current' : ''} />
        </button>
        <button
          onClick={onOpen}
          data-testid={`button-open-lead-${lead.id}`}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Inspect brief <ArrowUpRight size={13} />
        </button>
      </div>
    </div>
  );
}

function LeadDetail() {
  const { leadId = '' } = useParams<{ leadId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const lead = useGetLead(leadId);
  const update = useUpdateLead();
  const createOutreach = useCreateOutreach();

  if (lead.isLoading) return <PageFrame><LoadingRows count={3} /></PageFrame>;
  if (lead.isError || !lead.data) return <PageFrame><ErrorState onRetry={() => lead.refetch()} /></PageFrame>;

  const data = lead.data;
  const save = () => update.mutate({ leadId, data: { saved: !data.saved } }, {
    onSuccess: () => {
      qc.setQueryData(getGetLeadQueryKey(leadId), (old: Lead | undefined) => old ? { ...old, saved: !data.saved } : old);
      toast({ title: data.saved ? 'Removed from saved' : 'Opportunity saved' });
    }
  });

  const changeStage = (newStage: string) => update.mutate({ leadId, data: { status: newStage as any } }, {
    onSuccess: () => {
      qc.setQueryData(getGetLeadQueryKey(leadId), (old: Lead | undefined) => old ? { ...old, status: newStage as any } : old);
      qc.invalidateQueries({ queryKey: getGetPipelineQueryKey() });
      toast({ title: `Pipeline stage: ${newStage.replace('_', ' ')}` });
    }
  });

  const shortlist = () => update.mutate({ leadId, data: { status: 'shortlisted', saved: true } }, {
    onSuccess: () => {
      qc.setQueryData(getGetLeadQueryKey(leadId), (old: Lead | undefined) => old ? { ...old, status: 'shortlisted', saved: true } : old);
      qc.invalidateQueries({ queryKey: getGetPipelineQueryKey() });
      toast({ title: 'Lead shortlisted', description: 'Moved to Shortlisted stage in Pipeline.' });
    }
  });

  const draft = () => createOutreach.mutate({
    data: {
      leadId,
      channel: data.publicEmail ? 'email' : data.instagram ? 'instagram' : 'linkedin',
      tone: 'human',
      offer: 'a thoughtful first conversation about where I could help'
    }
  }, {
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getListOutreachQueryKey() });
      toast({ title: 'Outreach draft created', description: 'Review it before approving anything.' });
      setLocation('/outreach');
    },
    onError: () => toast({ title: 'Could not create draft' })
  });

  const brief = data.opportunityBrief;
  const primary = brief?.primaryContact ?? data.primaryContact;
  const peopleList = data.people ?? [];
  const contactPointsList = data.contactPoints ?? [];
  const observedFacts = brief?.observableFacts ?? data.evidence.filter((e) => e.type === 'VERIFIED');
  const inferencesList = brief?.inferences ?? data.evidence.filter((e) => e.type === 'INFERRED');
  const nextAction = brief?.recommendedNextAction;
  const sourcesList = brief?.sources ?? (data.evidence
    .filter((e) => e.sourceUrl)
    .map((e) => ({
      name: e.sourceName,
      url: e.sourceUrl!,
      observedAt: e.observedAt,
    }))
  );

  return (
    <PageFrame>
      <Link href="/discover" data-testid="link-lead-back" className="mb-8 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft size={14} /> Back to opportunities
      </Link>
      <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
        <div>
          {/* Header */}
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className={cx("rounded-full px-2 py-1 text-[10px] font-mono-radar uppercase tracking-[.08em]", data.sourceStatus === 'connected' ? "bg-emerald-100 text-emerald-800 font-bold" : "bg-[hsl(var(--accent)/.22)]")}>
                  {sourceLabel(data.sourceStatus)}
                </span>
                {data.fit && (
                  <span className={cx("rounded-full px-2.5 py-1 text-[10px] font-mono-radar uppercase tracking-[.08em] font-bold", data.fit === 'HIGH RELEVANCE' ? 'bg-emerald-100 text-emerald-800' : data.fit === 'POSSIBLE RELEVANCE' ? 'bg-amber-100 text-amber-800' : 'bg-muted text-muted-foreground')}>
                    {data.fit}
                  </span>
                )}
                {brief?.confidence && (
                  <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-mono-radar uppercase tracking-[.08em] font-semibold text-muted-foreground">
                    {brief.confidence} evidence completeness
                  </span>
                )}
                <span className="text-xs text-muted-foreground">{data.industry} · {data.location}</span>
              </div>
              <h1 className="font-display text-6xl leading-[.9] tracking-[-.04em]">{data.companyName}</h1>
              {data.website && (
                <div className="mt-3">
                  <a
                    href={data.website}
                    target="_blank"
                    rel="noreferrer"
                    data-testid="link-lead-website-header"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--primary))] hover:underline"
                  >
                    <Globe2 size={13} /> {data.website} <ExternalLink size={11} />
                  </a>
                </div>
              )}
              <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">{data.description}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <select
                value={data.status}
                onChange={e => changeStage(e.target.value)}
                data-testid="select-lead-stage"
                className="rounded-md border border-border bg-card px-2.5 py-2 text-xs font-mono-radar font-semibold uppercase text-foreground shadow-sm hover:border-[hsl(var(--primary)/.5)] cursor-pointer"
              >
                {stageLabels.map(s => (
                  <option key={s} value={s}>{s.replace('_', ' ')}</option>
                ))}
              </select>
              {data.status === 'shortlisted' ? (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  <Check size={14} /> Shortlisted
                </span>
              ) : (
                <button
                  onClick={shortlist}
                  data-testid="button-lead-shortlist"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold hover:bg-muted"
                >
                  <Bookmark size={14} /> Shortlist
                </button>
              )}
              <button
                onClick={save}
                data-testid="button-detail-save"
                title={data.saved ? 'Remove saved' : 'Save lead'}
                className={cx('grid size-9 shrink-0 place-items-center rounded-md border border-border transition-colors hover:border-[hsl(var(--primary))]', data.saved && 'bg-[hsl(var(--accent)/.2)] text-[hsl(var(--primary))]')}
              >
                <Bookmark size={16} className={data.saved ? 'fill-current' : ''} />
              </button>
            </div>
          </div>

          {/* WHO: 4-Dimension Metric Strip */}
          <div className="mb-10 grid gap-5 border-y border-border py-6 sm:grid-cols-4">
            <div>
              <div className="text-[10px] font-mono-radar uppercase tracking-[.12em] text-muted-foreground">Relevance score</div>
              <div className="mt-2 text-3xl font-semibold text-[hsl(var(--primary))] font-mono-radar">{data.relevance}<span className="text-sm text-muted-foreground">/100</span></div>
              <div className="mt-1 text-[10px] text-muted-foreground">Prioritization heuristic</div>
            </div>
            <div>
              <div className="text-[10px] font-mono-radar uppercase tracking-[.12em] text-muted-foreground">Confidence</div>
              <div className="mt-2 text-sm font-semibold capitalize font-mono-radar">{brief?.confidence ?? 'medium'}</div>
              <div className="mt-1 text-[10px] text-muted-foreground">Evidence completeness only</div>
            </div>
            <div>
              <div className="text-[10px] font-mono-radar uppercase tracking-[.12em] text-muted-foreground">Person status</div>
              <div className="mt-2 text-sm font-semibold flex items-center gap-1.5 flex-wrap">
                <span className={cx(
                  "rounded px-1.5 py-0.5 text-[9px] font-mono-radar uppercase font-bold",
                  primary?.verificationStatus === 'VERIFIED' ? 'bg-emerald-100 text-emerald-800' :
                  primary?.verificationStatus === 'SUPPORTED' ? 'bg-amber-100 text-amber-800' :
                  'bg-muted text-muted-foreground'
                )}>
                  Person: {primary?.verificationStatus ?? (data.founder ? 'SUPPORTED' : 'NOT OBSERVED')}
                </span>
                <span className="truncate">{primary ? primary.name : (data.founder ?? 'Not observed')}</span>
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground truncate">{primary ? primary.role : (data.founder ? 'Founder' : 'Not on researched pages')}</div>
            </div>
            <div>
              <div className="text-[10px] font-mono-radar uppercase tracking-[.12em] text-muted-foreground">Contact channel</div>
              <div className="mt-2 text-sm font-semibold flex items-center gap-1.5 flex-wrap">
                <span className={cx(
                  "rounded px-1.5 py-0.5 text-[9px] font-mono-radar uppercase font-bold",
                  brief?.contactEvidence?.status === 'VERIFIED_DIRECT' ? 'bg-emerald-100 text-emerald-800' :
                  brief?.contactEvidence?.status === 'SUPPORTED_DIRECT' ? 'bg-amber-100 text-amber-800' :
                  brief?.contactEvidence?.status === 'COMPANY_ONLY' ? 'bg-blue-100 text-blue-800' :
                  'bg-muted text-muted-foreground'
                )}>
                  Contact: {brief?.contactEvidence?.status ?? (data.contactVerified ? 'VERIFIED_DIRECT' : 'ABSENT')}
                </span>
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground truncate" title={brief?.contactEvidence?.details}>
                {brief?.contactEvidence?.details || (data.contactVerified ? 'Verified business email' : 'No direct contact observed')}
              </div>
            </div>
          </div>

          {/* WHY THIS LEAD SURFACED */}
          <section className="mb-10 border border-border bg-card p-6 md:p-7 shadow-sm" data-testid="section-why-relevant">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4" data-testid="section-opportunity-brief">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-[hsl(var(--primary))]" />
                <h2 className="text-xs font-mono-radar uppercase tracking-[.16em] font-bold text-foreground">
                  Why this lead surfaced
                </h2>
              </div>
              {brief?.whyRelevant && (
                <span className="text-[10px] font-mono-radar text-muted-foreground">{brief.whyRelevant.length} grounded reasons</span>
              )}
            </div>

            <p className="mt-5 text-base md:text-lg leading-8 font-medium text-foreground">
              {brief?.summary || data.description}
            </p>

            {brief?.whyRelevant && brief.whyRelevant.length > 0 && (
              <div className="mt-6 space-y-2.5">
                {brief.whyRelevant.map((reason, i) => (
                  <div key={i} className="flex items-start gap-3 border border-border/80 bg-background/60 p-3.5 text-xs leading-5">
                    <span className="font-mono-radar text-[11px] font-bold text-[hsl(var(--primary))] shrink-0 mt-0.5">
                      0{i + 1}
                    </span>
                    <span className="font-medium text-foreground">{reason}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* OPPORTUNITY HYPOTHESIS */}
          <section className="mb-10 border border-border bg-card p-6 md:p-7 shadow-sm" data-testid="section-opportunity-hypotheses">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
              <div className="flex items-center gap-2">
                <Target size={18} className="text-[hsl(var(--accent))]" />
                <h2 className="text-xs font-mono-radar uppercase tracking-[.16em] font-bold text-foreground">
                  Opportunity hypothesis
                </h2>
                <span className="rounded bg-[hsl(var(--accent)/.2)] px-2 py-0.5 text-[9px] font-mono-radar uppercase font-bold text-[hsl(var(--accent-foreground))]">
                  Inferred for your offer
                </span>
              </div>
            </div>

            <p className="mt-3 text-xs text-muted-foreground">
              Conversational entry points derived from observed web signals. Hypotheses to test, not verified internal needs.
            </p>

            {brief?.opportunity?.hypothesis && (
              <div className="mt-4 border border-border/80 bg-background/60 p-4 text-sm leading-7">
                <div className="text-[10px] font-mono-radar uppercase tracking-[.1em] text-[hsl(var(--primary))] font-semibold mb-1">
                  Synthesized angle
                </div>
                <p className="font-medium text-foreground">{brief.opportunity.hypothesis}</p>
                {brief.opportunity.explanation && (
                  <p className="mt-2 text-xs text-muted-foreground leading-5">{brief.opportunity.explanation}</p>
                )}
              </div>
            )}

            {data.opportunity.length > 0 && (
              <div className="mt-3 grid gap-2.5">
                {data.opportunity.map((point, i) => (
                  <div key={point} className="flex gap-3 border border-border/80 bg-background/60 p-3.5 text-xs leading-5">
                    <span className="font-mono-radar text-xs text-[hsl(var(--accent-foreground))] shrink-0">0{i + 1}</span>
                    <span>{point}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* RECOMMENDED NEXT ACTION */}
          {nextAction && (
            <section className="mb-10" data-testid="section-next-action">
              <div
                data-testid="banner-next-action"
                className={cx(
                  "flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-lg border shadow-sm transition-all",
                  nextAction.action === 'draft_outreach'
                    ? "bg-emerald-500/10 border-emerald-500/30 text-foreground"
                    : nextAction.action === 'research_contact'
                    ? "bg-amber-500/10 border-amber-500/30 text-foreground"
                    : nextAction.action === 'review_evidence'
                    ? "bg-blue-500/10 border-blue-500/30 text-foreground"
                    : "bg-muted/60 border-border text-foreground"
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0">
                    {nextAction.action === 'draft_outreach' ? (
                      <Send size={20} className="text-emerald-600 dark:text-emerald-400" />
                    ) : nextAction.action === 'research_contact' ? (
                      <Users size={20} className="text-amber-600 dark:text-amber-400" />
                    ) : nextAction.action === 'review_evidence' ? (
                      <FileText size={20} className="text-blue-600 dark:text-blue-400" />
                    ) : (
                      <Bookmark size={20} className="text-muted-foreground" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono-radar uppercase tracking-[.14em] font-bold text-muted-foreground">
                        Recommended Next Action
                      </span>
                      <span className="rounded bg-background px-2 py-0.5 text-[9px] font-mono-radar uppercase font-bold border border-border">
                        {nextAction.label}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground font-medium">
                      {nextAction.reason}
                    </p>
                  </div>
                </div>
                <div className="shrink-0">
                  {nextAction.action === 'draft_outreach' ? (
                    <button
                      onClick={draft}
                      disabled={createOutreach.isPending}
                      data-testid="button-brief-draft"
                      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                    >
                      {createOutreach.isPending ? 'Drafting…' : 'Draft outreach'} <Send size={13} />
                    </button>
                  ) : nextAction.action === 'research_contact' ? (
                    data.website ? (
                      <a
                        href={data.website}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-xs font-semibold hover:bg-muted"
                      >
                        Search website <ExternalLink size={13} />
                      </a>
                    ) : (
                      <span className="text-xs font-mono-radar text-muted-foreground">Manual lookup recommended</span>
                    )
                  ) : nextAction.action === 'review_evidence' ? (
                    <a
                      href="#section-observed-facts"
                      className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-xs font-semibold hover:bg-muted"
                    >
                      Inspect observations <ArrowDown size={13} />
                    </a>
                  ) : (
                    <button
                      onClick={save}
                      className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-xs font-semibold hover:bg-muted"
                    >
                      {data.saved ? 'Remove saved' : 'Save lead'}
                    </button>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* Observed Facts vs Inferences */}
          <div className="mt-12 space-y-10" id="section-observed-facts">
            {/* Observable Facts */}
            <section data-testid="section-observed-facts">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-display text-3xl">Observable facts</h2>
                    <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-mono-radar uppercase font-bold text-foreground">
                      VERIFIED FACTS
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Directly extracted from researched public pages. Observable business data only.</p>
                </div>
                <span className="text-[10px] font-mono-radar uppercase text-muted-foreground">{observedFacts.length} observations</span>
              </div>
              {observedFacts.length > 0 ? (
                <div className="space-y-3">
                  {observedFacts.map(item => (
                    <div key={item.id} className="border-l-2 border-emerald-600 bg-card px-5 py-4">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="text-sm leading-6 font-medium text-foreground">{item.statement}</p>
                        <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-mono-radar uppercase font-bold bg-muted text-foreground">
                          VERIFIED
                        </span>
                      </div>
                      {item.excerpt && (
                        <p className="mt-2 text-xs italic text-muted-foreground bg-muted/30 p-2.5 rounded border border-border/40">
                          &ldquo;{item.excerpt}&rdquo;
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] font-mono-radar uppercase tracking-[.08em] text-muted-foreground">
                        <span>{item.sourceName}</span>
                        <span>Observed {formatDate(item.observedAt)}</span>
                        {item.sourceUrl && (
                          <a href={item.sourceUrl} target="_blank" rel="noreferrer" data-testid={`link-evidence-${item.id}`} className="inline-flex items-center gap-1 text-[hsl(var(--primary))] font-semibold hover:underline">
                            Open source <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded border border-dashed border-border bg-card/60 p-6 text-center text-xs text-muted-foreground">
                  <FileText size={22} className="mx-auto mb-2 opacity-40" />
                  <p className="font-medium text-foreground">No direct factual observations recorded on researched pages.</p>
                </div>
              )}
            </section>

            {/* Inferences */}
            <section data-testid="section-inferences">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-display text-3xl">Inferences &amp; hypotheses</h2>
                    <span className="rounded bg-[hsl(var(--accent)/.2)] px-2 py-0.5 text-[9px] font-mono-radar uppercase font-bold text-[hsl(var(--accent-foreground))]">
                      INFERRED
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Interpretations derived from observable signals. Potential opportunity angles, not internal company statements.</p>
                </div>
                <span className="text-[10px] font-mono-radar uppercase text-muted-foreground">{inferencesList.length} hypotheses</span>
              </div>
              {inferencesList.length > 0 ? (
                <div className="space-y-3">
                  {inferencesList.map(item => (
                    <div key={item.id} className="border-l-2 border-[hsl(var(--accent))] bg-card px-5 py-4">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="text-sm leading-6 font-medium text-foreground">{item.statement}</p>
                        <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-mono-radar uppercase font-bold bg-[hsl(var(--accent)/.15)] text-[hsl(var(--accent-foreground))]">
                          INFERRED
                        </span>
                      </div>
                      {item.excerpt && (
                        <p className="mt-2 text-xs italic text-muted-foreground bg-muted/30 p-2.5 rounded border border-border/40">
                          &ldquo;{item.excerpt}&rdquo;
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] font-mono-radar uppercase tracking-[.08em] text-muted-foreground">
                        <span>{item.sourceName}</span>
                        <span>Observed {formatDate(item.observedAt)}</span>
                        {item.sourceUrl && (
                          <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[hsl(var(--primary))] font-semibold hover:underline">
                            Open source <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded border border-dashed border-border bg-card/60 p-6 text-center text-xs text-muted-foreground">
                  <Sparkles size={22} className="mx-auto mb-2 opacity-40 text-muted-foreground" />
                  <p className="font-medium text-foreground">No secondary inferences generated for this lead.</p>
                </div>
              )}

              <div className="mt-6 flex items-start gap-2.5 rounded border border-border/80 bg-muted/40 p-3.5 text-xs leading-5 text-muted-foreground">
                <CircleHelp size={15} className="mt-0.5 shrink-0 text-[hsl(var(--primary))]" />
                <span>RADAR rigorously distinguishes observable facts from derived hypotheses. Verified facts were directly observed on the indicated public pages. Hypotheses represent potential conversational angles based on those facts, not claims about company internal decisions.</span>
              </div>
            </section>
          </div>

          {/* People & Leadership Section */}
          <section className="mt-12" data-testid="section-people-leadership">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="font-display text-3xl">People &amp; leadership</h2>
                <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-mono-radar uppercase font-semibold text-muted-foreground">
                  {peopleList.length} observed
                </span>
              </div>
              <Users size={18} className="text-muted-foreground" />
            </div>
            {data.enrichmentSummary && (
              <p className="mb-4 text-xs text-muted-foreground bg-muted/20 p-3 rounded border border-border/50">
                {data.enrichmentSummary}
              </p>
            )}
            {peopleList.length > 0 ? (
              <div className="space-y-4">
                {peopleList.map((person) => {
                  const isPrimary = primary?.name === person.name;
                  return (
                    <div key={person.id} className={cx("border bg-card p-5 transition-all", isPrimary ? "border-[hsl(var(--primary)/.45)] ring-1 ring-[hsl(var(--primary)/.2)]" : "border-border")}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-semibold text-foreground">{person.name}</h3>
                            {isPrimary && (
                              <span className="rounded-full bg-[hsl(var(--accent)/.25)] px-2 py-0.5 text-[9px] font-mono-radar uppercase font-bold text-[hsl(var(--accent-foreground))]">
                                Primary Contact (Offer-Matched)
                              </span>
                            )}
                            <span className="rounded bg-muted px-2 py-0.5 text-[9px] font-mono-radar uppercase font-semibold text-muted-foreground">
                              {person.roleCategory.replace('_', ' ')}
                            </span>
                            <span className={cx("rounded px-2 py-0.5 text-[9px] font-mono-radar uppercase font-bold", person.verificationStatus === 'VERIFIED' ? "bg-emerald-100 text-emerald-800" : person.verificationStatus === 'SUPPORTED' ? "bg-amber-100 text-amber-800" : "bg-muted text-muted-foreground")}>
                              {person.verificationStatus}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-[hsl(var(--primary))] font-medium">{person.role}</p>
                          {person.selectionReason && isPrimary && (
                            <p className="mt-2 text-xs text-muted-foreground bg-[hsl(var(--primary)/.05)] border-l-2 border-[hsl(var(--primary))] pl-2.5 py-1">
                              <strong>Why selected:</strong> {person.selectionReason}
                            </p>
                          )}
                          {person.excerpt && (
                            <p className="mt-2 text-xs italic text-muted-foreground bg-muted/30 p-2 rounded border border-border/40">
                              &ldquo;{person.excerpt}&rdquo;
                            </p>
                          )}
                        </div>
                        {person.sourceUrl && (
                          <a href={person.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] font-mono-radar text-[hsl(var(--primary))] hover:underline">
                            Source <ExternalLink size={10} />
                          </a>
                        )}
                      </div>
                      {person.contactPoints && person.contactPoints.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-2 border-t border-border/60 pt-3">
                          {person.contactPoints.map((cp) => (
                            <div key={cp.id} className="inline-flex items-center gap-1.5 rounded border border-border bg-muted/30 px-2.5 py-1 text-xs">
                              {cp.type === 'email' ? <Mail size={12} className="text-muted-foreground" /> : <Linkedin size={12} className="text-muted-foreground" />}
                              <span className="font-mono text-xs">{cp.value}</span>
                              <span className={cx("rounded px-1 text-[8px] font-mono-radar uppercase font-bold", cp.verificationStatus === 'VERIFIED' ? "bg-emerald-100 text-emerald-800" : cp.verificationStatus === 'SUPPORTED' ? "bg-amber-100 text-amber-800" : "bg-muted text-muted-foreground")}>
                                {cp.verificationStatus}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded border border-dashed border-border bg-card/60 p-6 text-center text-xs text-muted-foreground">
                <Users size={24} className="mx-auto mb-2 opacity-40" />
                <p className="font-medium text-foreground">No leadership or team members observed on researched pages.</p>
                <p className="mt-1">RADAR does not guess names or fabricate people. Inspect public press or company about page directly.</p>
              </div>
            )}
          </section>

          {/* Contact Evidence Section */}
          <section className="mt-12" data-testid="section-contact-evidence">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="font-display text-3xl">Contact evidence</h2>
                <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-mono-radar uppercase font-semibold text-muted-foreground">
                  {contactPointsList.length} observed
                </span>
              </div>
              <ShieldCheck size={18} className="text-muted-foreground" />
            </div>
            {contactPointsList.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {contactPointsList.map((cp) => (
                  <div key={cp.id} className="flex flex-col justify-between border border-border bg-card p-4 text-xs">
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="flex items-center gap-1.5 font-mono-radar uppercase text-[10px] text-muted-foreground">
                          {cp.type === 'email' && <Mail size={12} />}
                          {cp.type === 'linkedin' && <Linkedin size={12} />}
                          {cp.type === 'instagram' && <Instagram size={12} />}
                          {cp.type === 'phone' && <Phone size={12} />}
                          {cp.type === 'contact_form' && <Globe2 size={12} />}
                          {cp.type.replace('_', ' ')} · {cp.scope}
                        </span>
                        <span className={cx("rounded px-1.5 py-0.5 text-[9px] font-mono-radar uppercase font-bold", cp.verificationStatus === 'VERIFIED' ? "bg-emerald-100 text-emerald-800" : cp.verificationStatus === 'SUPPORTED' ? "bg-amber-100 text-amber-800" : "bg-muted text-muted-foreground")}>
                          {cp.verificationStatus}
                        </span>
                      </div>
                      <div className="font-mono text-xs font-semibold break-all text-foreground">
                        {cp.value}
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
                      <span>{cp.isDirect ? 'Direct personal link' : 'Company general contact'}</span>
                      {cp.sourceUrl && (
                        <a href={cp.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[hsl(var(--primary))] hover:underline">
                          Source <ExternalLink size={9} />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded border border-dashed border-border bg-card/60 p-6 text-center text-xs text-muted-foreground">
                <Mail size={24} className="mx-auto mb-2 opacity-40" />
                <p className="font-medium text-foreground">No public contact channels observed on researched pages.</p>
                <p className="mt-1">RADAR strictly adheres to observed business data and does not synthesize unverified email addresses.</p>
              </div>
            )}
          </section>

          {/* Public Sources Section */}
          <section className="mt-12" data-testid="section-public-sources">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="font-display text-3xl">Public sources</h2>
                  <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-mono-radar uppercase font-semibold text-muted-foreground">
                    {sourcesList.length} researched {sourcesList.length === 1 ? 'page' : 'pages'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Public web pages researched during discovery and contact verification. Specific claim citations and page excerpts are linked directly under Observable Facts above.
                </p>
              </div>
              <Globe2 size={18} className="text-muted-foreground" />
            </div>
            {sourcesList.length > 0 ? (
              <div className="grid gap-2">
                {sourcesList.map((src, i) => (
                  <div key={i} className="flex flex-wrap items-center justify-between gap-3 border border-border bg-card p-3.5 text-xs">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-foreground truncate">{(src as any).name || (src as any).title || src.url}</p>
                      <p className="font-mono text-[11px] text-muted-foreground truncate">{src.url}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {src.observedAt && (
                        <span className="text-[10px] font-mono-radar text-muted-foreground">
                          Observed {formatDate(src.observedAt)}
                        </span>
                      )}
                      <a
                        href={src.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-2.5 py-1 text-[11px] font-semibold text-[hsl(var(--primary))] hover:bg-muted"
                      >
                        Visit <ExternalLink size={11} />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No public sources recorded.</p>
            )}
          </section>
        </div>

        {/* Sidebar */}
        <aside>
          <div className="sticky top-24 space-y-4">
            <div className="rounded-lg bg-[hsl(var(--primary))] p-5 text-[hsl(var(--primary-foreground))]">
              <div className="text-[10px] font-mono-radar uppercase tracking-[.14em] text-[hsl(var(--primary-foreground)/.56)]">Next human move</div>
              <h2 className="mt-4 font-display text-3xl">Make it personal.</h2>
              <p className="mt-2 text-sm leading-6 text-[hsl(var(--primary-foreground)/.68)]">Use the evidence as a starting point, not a claim. Edit every line before you approve.</p>
              <button onClick={draft} disabled={createOutreach.isPending} data-testid="button-create-outreach" className="mt-6 flex w-full items-center justify-center gap-2 rounded-md bg-[hsl(var(--accent))] px-4 py-3 text-xs font-semibold text-[hsl(var(--accent-foreground))] disabled:opacity-50">
                {createOutreach.isPending ? 'Drafting…' : 'Draft outreach'} <Send size={14} />
              </button>
            </div>

            {data.scoreBreakdown?.factors && data.scoreBreakdown.factors.length > 0 && (
              <div className="border border-border bg-card p-5" data-testid="section-score-breakdown">
                <div className="mb-4 flex items-center justify-between">
                  <div className="text-[10px] font-mono-radar uppercase tracking-[.14em] text-muted-foreground font-semibold">Score breakdown</div>
                  <span className="text-[10px] font-mono-radar text-[hsl(var(--primary))] font-semibold">Base {data.scoreBreakdown.baseScore ?? 5} pts</span>
                </div>
                <div className="space-y-3 divide-y divide-border/60 text-xs">
                  {data.scoreBreakdown.factors.map((f, i) => (
                    <div key={i} className="flex items-start justify-between gap-4 pt-3">
                      <div>
                        <span className="font-semibold text-foreground">{f.factor}</span>
                        <p className="mt-1 text-xs text-muted-foreground">{f.reason}</p>
                      </div>
                      <span className={cx("shrink-0 rounded px-2 py-0.5 font-mono text-xs font-semibold", (f.points ?? 0) >= 0 ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800")}>
                        {(f.points ?? 0) >= 0 ? `+${f.points ?? 0}` : f.points}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="border border-border bg-card p-5">
              <div className="text-[10px] font-mono-radar uppercase tracking-[.14em] text-muted-foreground">Public links</div>
              <div className="mt-4 space-y-3 text-xs">
                {data.website && (
                  <a href={data.website} target="_blank" rel="noreferrer" data-testid="link-lead-website" className="flex items-center gap-3 hover:text-[hsl(var(--primary))]">
                    <Globe2 size={15} /> Website <ExternalLink size={12} className="ml-auto" />
                  </a>
                )}
                {data.instagram && (
                  <a href={data.instagram} target="_blank" rel="noreferrer" data-testid="link-lead-instagram" className="flex items-center gap-3 hover:text-[hsl(var(--primary))]">
                    <Instagram size={15} /> Instagram <ExternalLink size={12} className="ml-auto" />
                  </a>
                )}
                {data.linkedin && (
                  <a href={data.linkedin} target="_blank" rel="noreferrer" data-testid="link-lead-linkedin" className="flex items-center gap-3 hover:text-[hsl(var(--primary))]">
                    <Linkedin size={15} /> LinkedIn <ExternalLink size={12} className="ml-auto" />
                  </a>
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </PageFrame>
  );
}

function OutreachPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const outreach = useListOutreach();
  const update = useUpdateOutreach();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Outreach>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const changeStatus = (item: Outreach, status: 'approved' | 'skipped') => update.mutate({ outreachId: item.id, data: { status } }, {
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getListOutreachQueryKey() });
      toast({ title: status === 'approved' ? 'Draft approved' : 'Draft skipped', description: status === 'approved' ? 'Approval saved. Ready to copy to email client.' : undefined });
    }
  });

  const saveEdit = (item: Outreach) => update.mutate({ outreachId: item.id, data: { subject: draft.subject, message: draft.message } }, {
    onSuccess: () => {
      setEditing(null);
      qc.invalidateQueries({ queryKey: getListOutreachQueryKey() });
      toast({ title: 'Draft updated' });
    }
  });

  const copyToClipboard = (item: Outreach) => {
    const text = item.subject ? `Subject: ${item.subject}\n\n${item.message}` : item.message;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
    }
    setCopiedId(item.id);
    toast({ title: 'Copied to clipboard', description: 'Paste into your email client to send.' });
    setTimeout(() => setCopiedId(null), 2500);
  };

  return (
    <PageFrame>
      <PageHeader
        eyebrow="Human outreach"
        title="Say the right thing."
        description="Drafts are grounded in observable facts and suggested angles. Approve, edit, or skip — RADAR never sends on your behalf."
        action={
          <div className="flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[10px] font-mono-radar uppercase tracking-[.12em] text-foreground">
            <span className="size-1.5 rounded-full bg-amber-500" />
            Sending disabled · Human review required
          </div>
        }
      />

      <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-border bg-card/60 p-4 text-xs">
        <div className="flex items-start sm:items-center gap-3">
          <ShieldCheck size={18} className="mt-0.5 sm:mt-0 text-[hsl(var(--primary))] shrink-0" />
          <p className="text-muted-foreground leading-5">
            Every draft is composed without guessed claims or fake metrics. Use the draft as a high-conviction conversation starter, then copy to your preferred email client.
          </p>
        </div>
        <span className="rounded bg-muted px-2 py-1 text-[9px] font-mono-radar uppercase font-bold text-muted-foreground shrink-0 self-start sm:self-auto">
          No automated sending
        </span>
      </div>

      {outreach.isLoading ? (
        <LoadingRows count={3} />
      ) : outreach.isError ? (
        <ErrorState onRetry={() => outreach.refetch()} />
      ) : outreach.data?.length ? (
        <div className="space-y-5">
          {outreach.data.map(item => (
            <article key={item.id} className="border border-border bg-card p-5 md:p-7" data-testid={`card-outreach-${item.id}`}>
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-mono-radar uppercase font-medium">
                      {item.channel}
                    </span>
                    <span className={cx(
                      'rounded-full px-2 py-1 text-[10px] font-mono-radar uppercase font-bold',
                      item.status === 'approved' ? 'bg-emerald-100 text-emerald-800' :
                      item.status === 'skipped' ? 'bg-destructive/10 text-destructive' :
                      'bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]'
                    )}>
                      {item.status}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</span>
                  </div>
                  <h2 className="mt-4 font-display text-3xl">{item.companyName}</h2>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => copyToClipboard(item)}
                    data-testid={`button-copy-outreach-${item.id}`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-semibold hover:bg-muted"
                  >
                    {copiedId === item.id ? (
                      <>
                        <Check size={14} className="text-emerald-500" />
                        <span className="text-emerald-600 dark:text-emerald-400">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy size={14} />
                        <span>Copy draft</span>
                      </>
                    )}
                  </button>

                  {item.status === 'draft' && (
                    <>
                      <button
                        onClick={() => { setEditing(item.id); setDraft(item); }}
                        data-testid={`button-edit-outreach-${item.id}`}
                        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-semibold hover:bg-muted"
                      >
                        <Edit3 size={14} /> Edit
                      </button>
                      <button
                        onClick={() => changeStatus(item, 'skipped')}
                        data-testid={`button-skip-outreach-${item.id}`}
                        className="rounded-md border border-border px-3 py-2 text-xs font-semibold hover:bg-muted"
                      >
                        Skip
                      </button>
                      <button
                        onClick={() => changeStatus(item, 'approved')}
                        data-testid={`button-approve-outreach-${item.id}`}
                        className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                      >
                        <Check size={14} /> Approve
                      </button>
                    </>
                  )}
                </div>
              </div>

              {editing === item.id ? (
                <div className="mt-6 space-y-3">
                  <input
                    value={draft.subject ?? ''}
                    onChange={e => setDraft({ ...draft, subject: e.target.value })}
                    data-testid={`input-outreach-subject-${item.id}`}
                    className="radar-input"
                    placeholder="Subject line…"
                  />
                  <textarea
                    value={draft.message ?? ''}
                    onChange={e => setDraft({ ...draft, message: e.target.value })}
                    data-testid={`input-outreach-message-${item.id}`}
                    className="radar-input min-h-40 resize-y"
                    placeholder="Email body…"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveEdit(item)}
                      data-testid={`button-save-outreach-${item.id}`}
                      className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                    >
                      Save changes
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      data-testid={`button-cancel-outreach-${item.id}`}
                      className="rounded-md border border-border px-3 py-2 text-xs font-semibold"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-6 grid gap-6 border-t border-border pt-5 md:grid-cols-[1fr_260px]">
                  <div>
                    {item.subject && (
                      <p className="text-xs font-semibold text-foreground bg-muted/30 p-2.5 rounded border border-border/40 mb-3">
                        <span className="text-muted-foreground mr-1.5 font-normal">Subject:</span>{item.subject}
                      </p>
                    )}
                    <p className="whitespace-pre-line text-sm leading-7 text-foreground font-medium">{item.message}</p>
                  </div>
                  <div className="border-l border-border pl-5">
                    <div className="text-[10px] font-mono-radar uppercase tracking-[.12em] text-muted-foreground font-bold">Why this message</div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.whyThisMessage}</p>
                    {item.status === 'approved' && (
                      <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 p-2 rounded border border-emerald-500/20">
                        <Check size={14} /> Approved · ready to send
                      </div>
                    )}
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title="No drafts in the queue" detail="Inspect an opportunity and ask RADAR for a human-first draft." href="/discover" action="Find an opportunity" />
      )}
    </PageFrame>
  );
}

function PipelinePage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const pipeline = useGetPipeline();
  const update = useUpdatePipelineStage();

  if (pipeline.isLoading) return <PageFrame><PageHeader eyebrow="Pipeline" title="Keep the thread." description="A lightweight view of every conversation in motion." /><LoadingRows count={4} /></PageFrame>;
  if (pipeline.isError) return <PageFrame><ErrorState onRetry={() => pipeline.refetch()} /></PageFrame>;

  const columns = pipeline.data?.columns ?? {};
  const move = (leadId: string, status: string) => update.mutate({ leadId, data: { status: status as any } }, {
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getGetPipelineQueryKey() });
      toast({ title: `Moved to ${status.replace('_', ' ')}` });
    }
  });

  return (
    <PageFrame>
      <PageHeader
        eyebrow="Pipeline"
        title="Keep the thread."
        description="Move leads as your relationship changes across 9 lifecycle states. The next step should always be obvious."
        action={
          <Link href="/discover" data-testid="link-pipeline-discover" className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2.5 text-xs font-semibold text-primary-foreground">
            <Plus size={14} /> Add from Discover
          </Link>
        }
      />
      <div className="flex gap-4 overflow-x-auto pb-6">
        {stageLabels.map(stage => {
          const leads = columns[stage] ?? [];
          return (
            <section key={stage} className="min-w-[270px] max-w-[320px] flex-1 shrink-0 rounded-lg border border-border bg-muted/20 p-3">
              <div className="mb-3 flex items-center justify-between border-b border-border pb-2.5">
                <div className="flex items-center gap-2">
                  <span className={cx(
                    'size-2 rounded-full',
                    stage === 'won' ? 'bg-emerald-500' :
                    stage === 'lost' ? 'bg-destructive' :
                    stage === 'shortlisted' ? 'bg-amber-500' :
                    stage === 'outreach_ready' ? 'bg-blue-500' :
                    stage === 'contacted' ? 'bg-purple-500' :
                    'bg-[hsl(var(--accent))]'
                  )} />
                  <h2 className="text-xs font-bold uppercase font-mono-radar tracking-wide">{stage.replace('_', ' ')}</h2>
                </div>
                <span className="font-mono-radar text-[10px] font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{leads.length}</span>
              </div>
              <div className="space-y-2.5">
                {leads.length > 0 ? (
                  leads.map(lead => (
                    <div key={lead.id} className="border border-border bg-card p-3.5 shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md" data-testid={`card-pipeline-${lead.id}`}>
                      <Link href={`/leads/${lead.id}`} data-testid={`link-pipeline-lead-${lead.id}`} className="block">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-semibold truncate hover:text-[hsl(var(--primary))]">{lead.companyName}</h3>
                          <ArrowUpRight size={13} className="shrink-0 text-muted-foreground" />
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground truncate">{lead.industry} · {lead.location}</p>
                      </Link>
                      <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2.5">
                        <span className="text-[10px] font-mono-radar font-semibold text-[hsl(var(--primary))]">{lead.relevance}/100</span>
                        <select
                          value={stage}
                          onChange={e => move(lead.id, e.target.value)}
                          data-testid={`select-pipeline-stage-${lead.id}`}
                          className="rounded border border-border/80 bg-background px-1.5 py-0.5 text-[10px] font-mono-radar font-medium capitalize outline-none cursor-pointer"
                        >
                          {stageLabels.map(s => (
                            <option key={s} value={s}>{s.replace('_', ' ')}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-4 text-center text-[11px] text-muted-foreground font-mono-radar border border-dashed border-border/60 rounded">
                    No leads in this stage
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </PageFrame>
  );
}

function RadarsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const radars = useListRadars();
  const run = useRunRadar();
  const updateRadar = useUpdateRadar();
  const { mode } = useExecutionMode();

  const [tab, setTab] = useState<'active' | 'archived' | 'all'>('active');
  const [editingRadar, setEditingRadar] = useState<Radar | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    target: '',
    offer: '',
    geography: '',
    intent: '',
    description: '',
    criteria: '',
  });

  const startEdit = (radar: Radar) => {
    setEditingRadar(radar);
    setEditForm({
      name: radar.name,
      target: radar.target,
      offer: radar.offer,
      geography: radar.geography ?? '',
      intent: radar.intent ?? '',
      description: radar.description ?? '',
      criteria: radar.criteria.join('\n'),
    });
  };

  const saveEdit = () => {
    if (!editingRadar) return;
    updateRadar.mutate({
      radarId: editingRadar.id,
      data: {
        name: editForm.name,
        target: editForm.target,
        offer: editForm.offer,
        geography: editForm.geography ? editForm.geography.trim() : undefined,
        intent: editForm.intent ? editForm.intent.trim() : undefined,
        description: editForm.description,
        criteria: editForm.criteria.split('\n').map(s => s.trim()).filter(Boolean),
      }
    }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListRadarsQueryKey() });
        setEditingRadar(null);
        toast({ title: 'Radar updated', description: 'Changes saved to profile.' });
      },
      onError: (err: any) => {
        const detail = err?.response?.data?.error || err?.message || 'Could not update Radar';
        toast({ title: 'Update failed', description: detail, variant: 'destructive' });
      }
    });
  };

  const toggleArchive = (radar: Radar) => {
    const newStatus = radar.status === 'archived' ? 'active' : 'archived';
    updateRadar.mutate({
      radarId: radar.id,
      data: { status: newStatus }
    }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListRadarsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        toast({
          title: newStatus === 'archived' ? 'Radar archived' : 'Radar restored',
          description: newStatus === 'archived' ? 'Moved to archived tab.' : 'Radar is now active.',
        });
      },
      onError: () => toast({ title: 'Could not change Radar status', variant: 'destructive' })
    });
  };

  const runRadar = (radar: Radar) => run.mutate({ radarId: radar.id, data: { mode } }, {
    onSuccess: result => {
      qc.invalidateQueries({ queryKey: getListRadarsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
      qc.invalidateQueries({ queryKey: getListLeadsQueryKey() });
      toast({
        title: 'Radar complete',
        description: mode === 'live'
          ? `${result.leadsFound} live opportunities found via Firecrawl.`
          : `${result.leadsFound} demo opportunities found.`,
      });
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.error || err?.message || 'Radar could not run';
      toast({
        title: 'Radar could not run',
        description: detail,
        variant: 'destructive',
      });
    }
  });

  const filteredRadars = useMemo(() => {
    const list = radars.data ?? [];
    if (tab === 'active') return list.filter(r => r.status !== 'archived');
    if (tab === 'archived') return list.filter(r => r.status === 'archived');
    return list;
  }, [radars.data, tab]);

  return (
    <PageFrame>
      <PageHeader
        eyebrow="Saved profiles"
        title="Your Radars."
        description="A Radar is a repeatable point of view. Keep it focused, tune its target or geography, and run it when the market changes."
        action={
          <Link href="/create" data-testid="link-radars-create" className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2.5 text-xs font-semibold text-primary-foreground">
            <Plus size={14} /> New Radar
          </Link>
        }
      />

      {/* Tabs */}
      <div className="mb-6 flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTab('active')}
            data-testid="tab-radars-active"
            className={cx(
              'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
              tab === 'active' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Active ({(radars.data ?? []).filter(r => r.status !== 'archived').length})
          </button>
          <button
            onClick={() => setTab('archived')}
            data-testid="tab-radars-archived"
            className={cx(
              'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
              tab === 'archived' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Archived ({(radars.data ?? []).filter(r => r.status === 'archived').length})
          </button>
          <button
            onClick={() => setTab('all')}
            data-testid="tab-radars-all"
            className={cx(
              'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
              tab === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            All ({(radars.data ?? []).length})
          </button>
        </div>
      </div>

      {/* Inline Edit Form Modal/Panel */}
      {editingRadar && (
        <div className="mb-8 border border-[hsl(var(--primary)/.4)] bg-card p-6 shadow-md rise-in">
          <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <Edit3 size={16} className="text-[hsl(var(--primary))]" />
              <h2 className="text-sm font-semibold text-foreground">Edit Radar: {editingRadar.name}</h2>
            </div>
            <button
              onClick={() => setEditingRadar(null)}
              data-testid="button-cancel-radar-edit"
              className="text-muted-foreground hover:text-foreground"
            >
              <X size={16} />
            </button>
          </div>
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Radar Name" hint="Identifying title">
                <input
                  value={editForm.name}
                  onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                  data-testid="input-edit-radar-name"
                  className="radar-input"
                />
              </Field>
              <Field label="Target Profile" hint="Who to search for">
                <input
                  value={editForm.target}
                  onChange={e => setEditForm({ ...editForm, target: e.target.value })}
                  data-testid="input-edit-radar-target"
                  className="radar-input"
                />
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Geography / Region" hint="e.g. India, United Kingdom, West Coast">
                <input
                  value={editForm.geography}
                  onChange={e => setEditForm({ ...editForm, geography: e.target.value })}
                  data-testid="input-edit-radar-geography"
                  className="radar-input"
                />
              </Field>
              <Field label="Search Intent & Focus" hint="e.g. DTC brands with active ecommerce store">
                <input
                  value={editForm.intent}
                  onChange={e => setEditForm({ ...editForm, intent: e.target.value })}
                  data-testid="input-edit-radar-intent"
                  className="radar-input"
                />
              </Field>
            </div>
            <Field label="Your Offer" hint="What service or product you offer">
              <textarea
                value={editForm.offer}
                onChange={e => setEditForm({ ...editForm, offer: e.target.value })}
                data-testid="input-edit-radar-offer"
                className="radar-input min-h-20 resize-y"
              />
            </Field>
            <Field label="Criteria Signals" hint="One criterion per line">
              <textarea
                value={editForm.criteria}
                onChange={e => setEditForm({ ...editForm, criteria: e.target.value })}
                data-testid="input-edit-radar-criteria"
                className="radar-input min-h-24 resize-y"
              />
            </Field>
            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => setEditingRadar(null)}
                className="rounded-md border border-border px-4 py-2 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={updateRadar.isPending}
                data-testid="button-save-radar-edit"
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
              >
                {updateRadar.isPending ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {radars.isLoading ? (
        <LoadingRows count={3} />
      ) : radars.isError ? (
        <ErrorState onRetry={() => radars.refetch()} />
      ) : filteredRadars.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {filteredRadars.map(radar => (
            <article
              key={radar.id}
              className="group border border-border bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-[hsl(var(--primary)/.45)]"
              data-testid={`card-radar-${radar.id}`}
            >
              <div className="flex items-start justify-between">
                <div className="grid size-10 place-items-center rounded-full bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]">
                  <RadarIcon size={18} />
                </div>
                <div className="flex items-center gap-2">
                  <span className={cx(
                    'rounded-full px-2 py-1 text-[10px] font-mono-radar uppercase font-bold',
                    radar.status === 'active' ? 'bg-[hsl(var(--accent)/.2)]' :
                    radar.status === 'archived' ? 'bg-muted text-muted-foreground' :
                    'bg-amber-100 text-amber-800'
                  )}>
                    {radar.status}
                  </span>
                  <button
                    onClick={() => startEdit(radar)}
                    data-testid={`button-edit-radar-${radar.id}`}
                    title="Edit Radar"
                    className="grid size-8 place-items-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Edit3 size={13} />
                  </button>
                  <button
                    onClick={() => toggleArchive(radar)}
                    data-testid={`button-archive-radar-${radar.id}`}
                    title={radar.status === 'archived' ? 'Restore Radar' : 'Archive Radar'}
                    className="grid size-8 place-items-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {radar.status === 'archived' ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                  </button>
                </div>
              </div>

              <h2 className="mt-5 font-display text-3xl">{radar.name}</h2>
              <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">{radar.description || radar.target}</p>

              {(radar.geography || radar.intent) && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {radar.geography && (
                    <span className="inline-flex items-center gap-1 rounded bg-muted/60 px-2 py-0.5 text-[10px] font-mono-radar text-foreground border border-border/60">
                      <Globe2 size={11} className="text-muted-foreground" /> {radar.geography}
                    </span>
                  )}
                  {radar.intent && (
                    <span className="inline-flex items-center gap-1 rounded bg-muted/60 px-2 py-0.5 text-[10px] font-mono-radar text-foreground border border-border/60">
                      <Target size={11} className="text-muted-foreground" /> {radar.intent}
                    </span>
                  )}
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-1.5">
                {radar.criteria.slice(0, 3).map(c => (
                  <span key={c} className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">
                    {c}
                  </span>
                ))}
              </div>

              <div className="mt-7 flex items-center justify-between border-t border-border pt-4">
                <span className="text-xs text-muted-foreground">
                  <strong className="text-foreground">{radar.leadCount}</strong> opportunities
                </span>
                <button
                  onClick={() => runRadar(radar)}
                  disabled={run.isPending || radar.status === 'archived'}
                  data-testid={`button-run-radar-${radar.id}`}
                  className="inline-flex items-center gap-2 text-xs font-semibold text-[hsl(var(--primary))] hover:underline disabled:opacity-50"
                >
                  {run.isPending ? 'Running…' : `Run in ${mode.toUpperCase()}`} <RefreshCw size={13} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title={tab === 'archived' ? 'No archived Radars' : 'No saved Radars'}
          detail={tab === 'archived' ? 'Radars you archive will appear here without being deleted.' : 'Build a point of view once, then run it whenever you need a fresh brief.'}
          href={tab === 'archived' ? undefined : '/create'}
          action={tab === 'archived' ? undefined : 'Create your first Radar'}
        />
      )}
    </PageFrame>
  );
}

function SettingsPage() {
  const { toast } = useToast(); const [saved, setSaved] = useState(false); const [offer, setOffer] = useState('Brand identity and launch systems for small teams.');
  const save = () => { setSaved(true); toast({ title: 'Settings saved', description: 'Your outreach context is ready for the next draft.' }); };
  return <PageFrame><PageHeader eyebrow="Workspace settings" title="Set the context." description="A little clarity here helps RADAR stay useful and honest everywhere else." /><div className="grid max-w-5xl gap-10 lg:grid-cols-[1fr_280px]"><div className="space-y-10"><section><SectionHeading icon={<UserRound size={16} />} title="Profile" detail="The human behind the offer." /><div className="grid gap-4 md:grid-cols-2"><Field label="Your name" hint=""><input defaultValue="Maya Chen" data-testid="input-settings-name" className="radar-input" /></Field><Field label="Studio / business" hint=""><input defaultValue="Maya Chen Studio" data-testid="input-settings-business" className="radar-input" /></Field></div></section><section><SectionHeading icon={<Target size={16} />} title="Your offer" detail="Used only to make drafts more relevant." /><Field label="What do you do?" hint=""><textarea value={offer} onChange={e => setOffer(e.target.value)} data-testid="input-settings-offer" className="radar-input min-h-28 resize-none" /></Field></section><section><SectionHeading icon={<Globe2 size={16} />} title="Sources" detail="Demo sources are clearly marked. Connected research is not active in this build." /><div className="flex items-center justify-between border border-border bg-card p-4"><div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-full bg-[hsl(var(--accent)/.2)]"><Globe2 size={16} /></div><div><p className="text-sm font-semibold">Demo evidence</p><p className="mt-1 text-xs text-muted-foreground">Fictional companies and observed signals</p></div></div><span className="rounded-full bg-muted px-2 py-1 text-[10px] font-mono-radar uppercase">Active</span></div></section><section><SectionHeading icon={<Send size={16} />} title="Outreach settings" detail="Keep the final call human." /><div className="space-y-3"><ToggleRow label="Require approval before anything is considered ready" checked /><ToggleRow label="Show why each message was drafted" checked /></div></section><button onClick={save} data-testid="button-save-settings" className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-xs font-semibold text-primary-foreground">{saved ? <Check size={14} /> : null}{saved ? 'Saved' : 'Save settings'}</button></div><aside className="h-fit border border-border bg-card p-5"><div className="flex items-center gap-2 text-[10px] font-mono-radar uppercase tracking-[.14em] text-[hsl(var(--primary))]"><CircleHelp size={14} /> About demo mode</div><p className="mt-4 text-sm leading-6 text-muted-foreground">RADAR’s first build is intentionally transparent. Company details, sources, and evidence are fictional. No research provider is connected, and no outreach can be sent.</p><div className="mt-5 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">That makes this a safe place to shape your process before connecting anything real.</div></aside></div></PageFrame>;
}
function SectionHeading({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) { return <div className="mb-5 flex items-start gap-3"><div className="mt-0.5 text-[hsl(var(--primary))]">{icon}</div><div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div></div>; }
function ToggleRow({ label, checked }: { label: string; checked: boolean }) { const [on, setOn] = useState(checked); return <button onClick={() => setOn(!on)} data-testid={`button-toggle-${label.slice(0, 10).replaceAll(' ', '-').toLowerCase()}`} className="flex w-full items-center justify-between border border-border bg-card p-4 text-left text-xs hover:bg-muted"><span>{label}</span><span className={cx('relative h-5 w-9 rounded-full transition-colors', on ? 'bg-[hsl(var(--primary))]' : 'bg-muted')}><span className={cx('absolute top-1 size-3 rounded-full bg-background transition-transform', on ? 'translate-x-5' : 'translate-x-1')} /></span></button>; }

function Router() { const [location] = useLocation(); return <ErrorBoundary resetKey={location}><Shell><Switch><Route path="/" component={Home} /><Route path="/create" component={Create} /><Route path="/discover" component={Discover} /><Route path="/leads/:leadId" component={LeadDetail} /><Route path="/outreach" component={OutreachPage} /><Route path="/pipeline" component={PipelinePage} /><Route path="/radars" component={RadarsPage} /><Route path="/settings" component={SettingsPage} /><Route component={NotFound} /></Switch></Shell></ErrorBoundary>; }
function App() {
  const [mode, setMode] = useState<ExecutionMode>('demo');
  return (
    <ExecutionModeContext.Provider value={{ mode, setMode }}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ExecutionModeContext.Provider>
  );
}
export default App;