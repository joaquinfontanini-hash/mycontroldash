import { useState, useMemo } from "react";
import {
  useListFiscalUpdates, useGetFiscalMetrics, useToggleFiscalSaved,
  getListFiscalUpdatesQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  Briefcase, AlertTriangle, Bookmark, BookmarkCheck, RefreshCw,
  Search, X, SlidersHorizontal, ShieldCheck, Info, LayoutGrid, List,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import {
  Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent,
} from "@/components/ui/empty";
import { BASE } from "@/lib/base-url";

type FiscalItem = {
  id: number; title: string; jurisdiction: string; category: string;
  organism: string; source?: string | null; date: string; impact: string;
  summary: string; requiresAction: boolean; isSaved: boolean;
  isNormative?: boolean; sourceUrl?: string | null; tags?: string | null;
  qualityScore?: number; qualityIssues?: string | null;
  needsReview?: boolean; isHidden?: boolean; createdAt: string;
};

const FISCAL_SOURCE_CATALOG = [
  { name:"Ámbito Financiero", shortName:"Ámbito",     initials:"ÁM", avatarBg:"bg-orange-500/15",  avatarText:"text-orange-600 dark:text-orange-400", ringColor:"ring-orange-500/50" },
  { name:"Tributum",          shortName:"Tributum",   initials:"TR", avatarBg:"bg-cyan-500/15",    avatarText:"text-cyan-600 dark:text-cyan-400",     ringColor:"ring-cyan-500/50" },
  { name:"Contadores en Red", shortName:"Cont. Red",  initials:"CR", avatarBg:"bg-lime-500/15",    avatarText:"text-lime-600 dark:text-lime-500",     ringColor:"ring-lime-500/50" },
  { name:"Rentas Neuquén",    shortName:"Rentas NQN", initials:"RN", avatarBg:"bg-violet-500/15",  avatarText:"text-violet-600 dark:text-violet-400", ringColor:"ring-violet-500/50" },
  { name:"AFIP",              shortName:"AFIP",       initials:"AF", avatarBg:"bg-blue-500/15",    avatarText:"text-blue-600 dark:text-blue-400",     ringColor:"ring-blue-500/50" },
  { name:"Boletín Oficial",   shortName:"Boletin Of.",initials:"BO", avatarBg:"bg-emerald-500/15", avatarText:"text-emerald-600 dark:text-emerald-400",ringColor:"ring-emerald-500/50" },
  { name:"El Cronista",       shortName:"Cronista",   initials:"EC", avatarBg:"bg-rose-500/15",    avatarText:"text-rose-600 dark:text-rose-400",     ringColor:"ring-rose-500/50" },
  { name:"iProfesional",      shortName:"iProf.",     initials:"IP", avatarBg:"bg-amber-500/15",   avatarText:"text-amber-600 dark:text-amber-400",   ringColor:"ring-amber-500/50" },
];

const IMPACT_COLORS = {
  high:   "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
  medium: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
  low:    "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
} as const;
const IMPACT_LABELS = { high:"Alto", medium:"Medio", low:"Bajo" } as const;

const QUICK_FILTERS = [
  { key:"all",            label:"Todas" },
  { key:"requiresAction", label:"Requiere Acción" },
  { key:"high",           label:"Alto Impacto" },
  { key:"normative",      label:"Normativas" },
  { key:"saved",          label:"Guardadas" },
];
const DATE_RANGES = [
  { key:"all",    label:"Todo" },
  { key:"2d",     label:"Últimos 2 días" },
  { key:"7d",     label:"Últimos 7 días" },
  { key:"30d",    label:"Últimos 30 días" },
  { key:"90d",    label:"Últimos 90 días" },
  { key:"custom", label:"Personalizado..." },
];

function qualityColor(s:number){return s>=80?"bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400":s>=60?"bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400":"bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";}
function qualityLabel(s:number){return s>=80?"Verificado":s>=60?"Aceptable":"Revisar";}
function parseIssues(raw?:string|null):string[]{if(!raw)return[];try{return JSON.parse(raw) as string[];}catch{return[];}}
function getSourceEntry(name?:string|null){return FISCAL_SOURCE_CATALOG.find(s=>s.name===name)??{name:name??"Fuente",shortName:(name??"?").slice(0,8),initials:(name??"?").slice(0,2).toUpperCase(),avatarBg:"bg-slate-500/15",avatarText:"text-slate-600 dark:text-slate-400",ringColor:"ring-slate-500/50"};}

function FiscalCard({item,onToggleSave}:{item:FiscalItem;onToggleSave:(id:number)=>void;}){
  const [expanded,setExpanded]=useState(false);
  const src=getSourceEntry(item.source);
  const issues=parseIssues(item.qualityIssues);
  const qs=item.qualityScore??70;
  return(
    <div className={`rounded-xl border bg-card p-4 space-y-3 transition-colors ${item.requiresAction?"border-amber-300/60 dark:border-amber-700/40":""}`}>
      <div className="flex items-start gap-3">
        <div className={`h-9 w-9 rounded-lg ${src.avatarBg} flex items-center justify-center shrink-0 ring-1 ${src.ringColor}`}>
          <span className={`text-[11px] font-bold ${src.avatarText}`}>{src.initials}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            <p className="text-sm font-semibold leading-snug flex-1 min-w-0">{item.title}</p>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 ${IMPACT_COLORS[item.impact as keyof typeof IMPACT_COLORS]??IMPACT_COLORS.low}`}>
              {IMPACT_LABELS[item.impact as keyof typeof IMPACT_LABELS]??item.impact}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-[10px] text-muted-foreground">{src.shortName}</span>
            <span className="text-[10px] text-muted-foreground">·</span>
            <span className="text-[10px] text-muted-foreground">{item.date}</span>
            <span className="text-[10px] text-muted-foreground">·</span>
            <span className="text-[10px] text-muted-foreground capitalize">{item.category}</span>
            {item.isNormative&&<span className="flex items-center gap-0.5 text-[10px] text-blue-600 dark:text-blue-400"><ShieldCheck className="h-2.5 w-2.5"/>Normativa</span>}
            {item.requiresAction&&<span className="flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400 font-semibold"><AlertTriangle className="h-2.5 w-2.5"/>Requiere acción</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={()=>onToggleSave(item.id)} title={item.isSaved?"Quitar":"Guardar"}>
            {item.isSaved?<BookmarkCheck className="h-3.5 w-3.5 text-primary"/>:<Bookmark className="h-3.5 w-3.5 text-muted-foreground"/>}
          </Button>
          {item.sourceUrl&&<a href={item.sourceUrl} target="_blank" rel="noopener noreferrer"><Button variant="ghost" size="icon" className="h-7 w-7"><ExternalLink className="h-3.5 w-3.5 text-muted-foreground"/></Button></a>}
        </div>
      </div>
      <p className={`text-xs text-muted-foreground leading-relaxed ${!expanded?"line-clamp-2":""}`}>{item.summary}</p>
      {item.summary.length>120&&<button onClick={()=>setExpanded(v=>!v)} className="text-[10px] text-primary hover:text-primary/80">{expanded?"Mostrar menos":"Leer más"}</button>}
      {item.qualityScore!==undefined&&(
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${qualityColor(qs)}`}>{qualityLabel(qs)} ({qs})</span>
          {item.needsReview&&<span className="flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400"><Info className="h-2.5 w-2.5"/>Requiere revisión</span>}
          {issues.length>0&&<span className="text-[10px] text-muted-foreground">{issues.join(", ")}</span>}
        </div>
      )}
    </div>
  );
}

export default function FiscalPage(){
  const [quickFilter,setQuickFilter]=useState("all");
  const [onlyToday,setOnlyToday]=useState(false);
  const [searchQuery,setSearchQuery]=useState("");
  const [categoryFilter,setCategoryFilter]=useState("all");
  const [dateRange,setDateRange]=useState("30d");
  const [customDays,setCustomDays]=useState(14);
  const [showFilters,setShowFilters]=useState(false);
  const [activeSources,setActiveSources]=useState<string[]>([]);
  const [refreshing,setRefreshing]=useState(false);
  const [lastRefreshed,setLastRefreshed]=useState<string|null>(null);
  const [qualityMin,setQualityMin]=useState(40);
  const [viewMode,setViewMode]=useState<"cards"|"table">("cards");

  const toggleSource=(n:string)=>setActiveSources(p=>p.includes(n)?p.filter(s=>s!==n):[...p,n]);

  const{data:updates,isLoading:updatesLoading,isError:updatesError}=useListFiscalUpdates({
    impact:quickFilter==="high"?"high":undefined,
    requiresAction:quickFilter==="requiresAction"?"true":undefined,
  });
  const{data:metrics,isLoading:metricsLoading,isError:metricsError}=useGetFiscalMetrics();
  const toggleSaved=useToggleFiscalSaved();
  const queryClient=useQueryClient();

  const handleRefresh=async()=>{
    setRefreshing(true);
    try{
      // credentials:"include" — el original lo omitía, causando 401 en Railway
      const res=await fetch(`${BASE}/api/fiscal/refresh`,{method:"POST",credentials:"include"});
      if(res.ok){
        setLastRefreshed(new Date().toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}));
        void queryClient.invalidateQueries({queryKey:getListFiscalUpdatesQueryKey()});
      }
    }catch{}
    setRefreshing(false);
  };

  const handleToggleSave=(id:number)=>{
    toggleSaved.mutate({id},{onSuccess:()=>void queryClient.invalidateQueries({queryKey:getListFiscalUpdatesQueryKey()})});
  };

  const displayed=useMemo<FiscalItem[]>(()=>{
    let items=(updates??[]) as FiscalItem[];
    items=items.filter(u=>(u.qualityScore??70)>=qualityMin);
    if(onlyToday){const t=new Date().toISOString().split("T")[0]!;items=items.filter(u=>(u.date?.trim()??"").startsWith(t));}
    if(quickFilter==="saved")items=items.filter(u=>u.isSaved);
    if(quickFilter==="normative")items=items.filter(u=>u.isNormative);
    if(categoryFilter!=="all")items=items.filter(u=>u.category===categoryFilter);
    if(dateRange!=="all"){
      const days=dateRange==="2d"?2:dateRange==="7d"?7:dateRange==="30d"?30:dateRange==="90d"?90:customDays;
      const cutoff=new Date();cutoff.setDate(cutoff.getDate()-days);
      items=items.filter(u=>{try{return new Date(u.date+"T12:00:00")>=cutoff;}catch{return true;}});
    }
    if(searchQuery.trim()){const q=searchQuery.toLowerCase().trim();items=items.filter(u=>u.title.toLowerCase().includes(q)||u.summary.toLowerCase().includes(q)||u.organism.toLowerCase().includes(q)||u.category.toLowerCase().includes(q));}
    if(activeSources.length>0)items=items.filter(u=>u.source!=null&&activeSources.includes(u.source));
    return items;
  },[updates,quickFilter,onlyToday,categoryFilter,dateRange,customDays,searchQuery,activeSources,qualityMin]);

  const displayedMetrics=useMemo(()=>({
    total:displayed.length,
    highImpact:displayed.filter(u=>u.impact==="high").length,
    requiresAction:displayed.filter(u=>u.requiresAction).length,
    avgQualityScore:displayed.length?Math.round(displayed.reduce((a,u)=>a+(u.qualityScore??70),0)/displayed.length):null,
  }),[displayed]);

  const categories=useMemo(()=>[...new Set(((updates??[]) as FiscalItem[]).map(u=>u.category).filter(Boolean))].sort(),[updates]);
  const availableSources=useMemo(()=>new Set(((updates??[]) as FiscalItem[]).map(u=>u.source).filter((s):s is string=>Boolean(s))),[updates]);
  const hasActiveFilters=onlyToday||categoryFilter!=="all"||(dateRange!=="30d"&&dateRange!=="all")||searchQuery.trim()!==""||qualityMin>40||activeSources.length>0;
  const clearFilters=()=>{setOnlyToday(false);setCategoryFilter("all");setDateRange("30d");setCustomDays(14);setSearchQuery("");setQualityMin(40);setActiveSources([]);};

  // Estado de carga — consistente con index.tsx
  if(updatesLoading||metricsLoading){
    return(
      <div className="space-y-4">
        <Skeleton className="h-9 w-52"/>
        <div className="grid gap-4 md:grid-cols-4">{[...Array(4)].map((_,i)=><Skeleton key={i} className="h-24 rounded-xl"/>)}</div>
        <div className="space-y-3">{[...Array(5)].map((_,i)=><Skeleton key={i} className="h-36 rounded-xl"/>)}</div>
      </div>
    );
  }

  // Estado de error — mismo patrón que index.tsx
  if(updatesError){
    return(
      <div className="flex items-center gap-3 text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">
        <AlertTriangle className="h-5 w-5 shrink-0"/>
        Error al cargar el Monitor Fiscal. Intentá actualizar la página.
      </div>
    );
  }

  return(
    <div className="space-y-6 w-full">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Monitor Fiscal</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Actualizaciones normativas e impositivas. AFIP, Rentas Neuquén y más.
            {lastRefreshed&&<span className="ml-1 text-green-600 dark:text-green-400">Actualizado a las {lastRefreshed}.</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center border rounded-lg overflow-hidden">
            <button onClick={()=>setViewMode("cards")} className={`px-2.5 py-1.5 text-xs flex items-center gap-1 transition-colors ${viewMode==="cards"?"bg-primary text-primary-foreground":"text-muted-foreground hover:text-foreground"}`}><LayoutGrid className="h-3.5 w-3.5"/></button>
            <button onClick={()=>setViewMode("table")} className={`px-2.5 py-1.5 text-xs flex items-center gap-1 transition-colors border-l ${viewMode==="table"?"bg-primary text-primary-foreground":"text-muted-foreground hover:text-foreground"}`}><List className="h-3.5 w-3.5"/></button>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshing?"animate-spin":""}`}/>{refreshing?"Actualizando...":"Actualizar"}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        {[
          {label:"Total visible",  value:displayedMetrics.total,          color:"text-foreground",                    bg:"bg-muted/60",                      filterKey:"all",            ring:"ring-2 ring-foreground/30"},
          {label:"Alto Impacto",   value:displayedMetrics.highImpact,     color:"text-red-600 dark:text-red-400",    bg:"bg-red-50 dark:bg-red-900/20",      filterKey:"high",           ring:"ring-2 ring-red-500"},
          {label:"Requiere Acción",value:displayedMetrics.requiresAction, color:"text-amber-600 dark:text-amber-400",bg:"bg-amber-50 dark:bg-amber-900/20",  filterKey:"requiresAction", ring:"ring-2 ring-amber-500"},
          {label:"Calidad prom.",  value:displayedMetrics.avgQualityScore!=null?`${displayedMetrics.avgQualityScore}`:"–", color:"text-emerald-600 dark:text-emerald-400",bg:"bg-emerald-50 dark:bg-emerald-900/20",filterKey:null,ring:""},
        ].map(m=>{
          const isActive=m.filterKey!==null&&quickFilter===m.filterKey;
          const isClickable=m.filterKey!==null;
          return(
            <button key={m.label} onClick={()=>{if(isClickable)setQuickFilter(isActive?"all":m.filterKey!);}} disabled={!isClickable}
              className={["text-left rounded-xl p-4 transition-all",m.bg,isClickable?"cursor-pointer hover:scale-[1.03] hover:shadow-md":"cursor-default",isActive?m.ring:""].join(" ")}>
              <p className="text-xs text-muted-foreground mb-1">{m.label}</p>
              <p className={`text-2xl font-bold ${m.color}`}>{m.value}</p>
            </button>
          );
        })}
      </div>

      {metrics&&!metricsError&&(metrics.needsReview??0)>0&&(
        <div className="flex items-center gap-2.5 text-sm rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0"/>
          <span className="text-amber-800 dark:text-amber-300">
            {metrics.needsReview} {metrics.needsReview===1?"registro requiere":"registros requieren"} revisión manual.
            {(metrics.discarded??0)>0&&` ${metrics.discarded} descartados por calidad insuficiente.`}
          </span>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={()=>setOnlyToday(v=>!v)} className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all border ${onlyToday?"bg-primary text-primary-foreground border-primary shadow-sm":"bg-muted/60 text-muted-foreground border-transparent hover:bg-muted hover:text-foreground"}`}><span>📅</span>Solo hoy</button>
          {QUICK_FILTERS.map(f=>(
            <button key={f.key} onClick={()=>setQuickFilter(f.key)} className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-150 border ${quickFilter===f.key?"bg-primary text-primary-foreground border-primary shadow-sm":"bg-muted/60 text-muted-foreground border-transparent hover:bg-muted hover:text-foreground"}`}>{f.label}</button>
          ))}
          <button onClick={()=>setShowFilters(v=>!v)} className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all border ${showFilters||hasActiveFilters?"bg-primary/10 text-primary border-primary/30":"bg-muted/60 text-muted-foreground border-transparent hover:bg-muted hover:text-foreground"}`}>
            <SlidersHorizontal className="h-3.5 w-3.5"/>Filtros{hasActiveFilters&&<span className="ml-1 text-primary text-xs">●</span>}
          </button>
        </div>

        {showFilters&&(
          <div className="rounded-xl border bg-card p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Buscar</p>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground"/>
                  <Input value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} placeholder="Título, organismo..." className="pl-7 h-8 text-xs"/>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Categoría</p>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    {categories.map(c=><SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Rango</p>
                <Select value={dateRange} onValueChange={setDateRange}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger>
                  <SelectContent>{DATE_RANGES.map(r=><SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>)}</SelectContent>
                </Select>
                {dateRange==="custom"&&<Input type="number" value={customDays} min={1} max={365} onChange={e=>setCustomDays(Number(e.target.value))} className="h-7 text-xs mt-1" placeholder="Días"/>}
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Calidad mínima</p>
                <Select value={String(qualityMin)} onValueChange={v=>setQualityMin(Number(v))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger>
                  <SelectContent>{[0,20,40,60,80].map(n=><SelectItem key={n} value={String(n)}>{n}+</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            {availableSources.size>0&&(
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Fuentes</p>
                <div className="flex flex-wrap gap-1.5">
                  {[...availableSources].map(src=>{
                    const entry=getSourceEntry(src);
                    const active=activeSources.includes(src);
                    return(
                      <button key={src} onClick={()=>toggleSource(src)} className={`px-2.5 py-1 rounded-full text-xs border transition-all ${active?"bg-primary text-primary-foreground border-primary":"bg-muted/50 text-muted-foreground border-muted-foreground/20 hover:border-primary/40"}`}>{entry.shortName}</button>
                    );
                  })}
                </div>
              </div>
            )}
            {hasActiveFilters&&<button onClick={clearFilters} className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80"><X className="h-3 w-3"/>Limpiar filtros</button>}
          </div>
        )}
      </div>

      {displayed.length===0?(
        <Empty>
          <EmptyHeader>
            <EmptyMedia><Briefcase className="h-8 w-8 text-muted-foreground"/></EmptyMedia>
            <EmptyTitle>Sin actualizaciones</EmptyTitle>
            <EmptyDescription>No hay actualizaciones fiscales que coincidan con los filtros aplicados.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{hasActiveFilters&&<Button variant="outline" size="sm" onClick={clearFilters}><X className="h-3.5 w-3.5 mr-1.5"/>Limpiar filtros</Button>}</EmptyContent>
        </Empty>
      ):viewMode==="cards"?(
        <div className="space-y-3">{displayed.map(item=><FiscalCard key={item.id} item={item} onToggleSave={handleToggleSave}/>)}</div>
      ):(
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-xs">
            <thead><tr className="border-b bg-muted/50">
              <th className="text-left py-2 px-3 font-medium text-muted-foreground">Título</th>
              <th className="text-left py-2 px-3 font-medium text-muted-foreground">Categoría</th>
              <th className="text-left py-2 px-3 font-medium text-muted-foreground">Impacto</th>
              <th className="text-left py-2 px-3 font-medium text-muted-foreground">Fecha</th>
              <th className="text-left py-2 px-3 font-medium text-muted-foreground">Acciones</th>
            </tr></thead>
            <tbody>
              {displayed.map(item=>{
                const src=getSourceEntry(item.source);
                return(
                  <tr key={item.id} className={`border-b hover:bg-muted/30 transition-colors text-xs ${item.requiresAction?"bg-amber-50/30 dark:bg-amber-950/10":""}`}>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${src.avatarBg} ${src.avatarText}`}>{src.initials}</span>
                        <span className="truncate max-w-[200px] font-medium">{item.title}</span>
                        {item.requiresAction&&<AlertTriangle className="h-3 w-3 text-amber-500 shrink-0"/>}
                        {item.isNormative&&<ShieldCheck className="h-3 w-3 text-blue-500 shrink-0"/>}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-muted-foreground capitalize">{item.category}</td>
                    <td className="py-2 px-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${IMPACT_COLORS[item.impact as keyof typeof IMPACT_COLORS]??IMPACT_COLORS.low}`}>{IMPACT_LABELS[item.impact as keyof typeof IMPACT_LABELS]??item.impact}</span></td>
                    <td className="py-2 px-3 text-muted-foreground">{item.date}</td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={()=>handleToggleSave(item.id)}>
                          {item.isSaved?<BookmarkCheck className="h-3 w-3 text-primary"/>:<Bookmark className="h-3 w-3 text-muted-foreground"/>}
                        </Button>
                        {item.sourceUrl&&<a href={item.sourceUrl} target="_blank" rel="noopener noreferrer"><Button variant="ghost" size="icon" className="h-6 w-6"><ExternalLink className="h-3 w-3 text-muted-foreground"/></Button></a>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
