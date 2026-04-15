import { guessDomain } from "@/lib/company-logos";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Search, Building, Building2, AlertCircle, X, Plus, ArrowLeft, Loader2, Pencil, Trash2, Users, Handshake, Globe, MapPin, Filter, ChevronDown, ChevronUp, Check, Sparkles, ShieldCheck, ExternalLink, CheckCircle2, XCircle, Clock, Circle, Download, FolderTree, Folder, FolderOpen, ChevronRight, Briefcase, Crown, LinkIcon, Upload, FileText, RefreshCw, ArrowUp, UserCheck, FileSearch, Copy, Bot, BotOff, Zap, Linkedin, Phone, Factory, UsersRound, CalendarDays } from "lucide-react";
import { CompanyLeasingSchedule as CompanyLeasingScheduleSection } from "@/pages/leasing-schedule";
import { ScrollableTable } from "@/components/scrollable-table";
import { ColumnFilterPopover } from "@/components/column-filter-popover";
import { useState, useMemo, useRef, useEffect } from "react";
import { trackRecentItem } from "@/hooks/use-recent-items";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { useRoute, Link } from "wouter";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CRM_OPTIONS } from "@/lib/crm-options";
import { InlineText, InlineSelect, InlineLabelSelect, InlineMultiSelect } from "@/components/inline-edit";
import { buildUserColorMap } from "@/lib/agent-colors";
import { EntityPicker } from "@/components/entity-picker";
import { InlineAddress } from "@/components/address-autocomplete";
import type { CrmCompany, CrmContact, CrmDeal, CrmProperty } from "@shared/schema";
import { BrandProfilePanel } from "@/components/brand-profile-panel";

interface CHSearchResult {
  companyNumber: string;
  title: string;
  companyStatus: string;
  companyType: string;
  dateOfCreation: string;
  addressSnippet: string;
}

interface CHProfile {
  companyNumber: string;
  companyName: string;
  companyStatus: string;
  companyType: string;
  dateOfCreation: string;
  registeredOfficeAddress: Record<string, string> | null;
  sicCodes: string[] | null;
  hasCharges: boolean;
  hasInsolvencyHistory: boolean;
  canFile: boolean;
  jurisdiction: string;
  accountsOverdue: boolean;
  confirmationStatementOverdue: boolean;
  lastAccountsMadeUpTo: string | null;
}

function extractDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = raw.startsWith("http") ? raw : `https://${raw}`;
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    const cleaned = raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    return cleaned || null;
  }
}

function CompanyLogoImg({ domain, name, size = 40 }: { domain: string | null | undefined; name: string | null | undefined; size?: number }) {
  const [failCount, setFailCount] = useState(0);

  const d = extractDomain(domain);
  const guessedDomain = guessDomain(name);

  const logoSources: string[] = [];
  if (d) {
    logoSources.push(`https://logo.clearbit.com/${d}?size=${Math.min(size * 3, 512)}`);
    logoSources.push(`https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${d}&size=128`);
  }
  if (guessedDomain && guessedDomain !== d) {
    logoSources.push(`https://logo.clearbit.com/${guessedDomain}?size=${Math.min(size * 3, 512)}`);
    logoSources.push(`https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${guessedDomain}&size=128`);
  }

  if (failCount >= logoSources.length) {
    const initials = (name || "?").split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);
    return (
      <div
        className="rounded-lg bg-muted flex items-center justify-center shrink-0 text-xs font-bold text-muted-foreground"
        style={{ width: size, height: size }}
        data-testid="company-logo-fallback"
      >
        {initials}
      </div>
    );
  }

  return (
    <img
      src={logoSources[failCount]}
      alt={name || "Company logo"}
      className="rounded-lg shrink-0 object-contain bg-white border"
      style={{ width: size, height: size }}
      onError={() => setFailCount(c => c + 1)}
      data-testid="company-logo"
    />
  );
}

function formatCHAddress(addr: any): string {
  if (!addr) return "";
  return [addr.address_line_1, addr.address_line_2, addr.locality, addr.region, addr.postal_code, addr.country].filter(Boolean).join(", ");
}

function KycSection({ title, icon: Icon, children, defaultOpen = false }: { title: string; icon: any; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border rounded-lg overflow-hidden">
      <button className="w-full flex items-center gap-2 p-2.5 hover:bg-muted/50 transition-colors text-left" onClick={() => setOpen(!open)}>
        <Icon className="w-3.5 h-3.5 text-primary shrink-0" />
        <span className="text-xs font-semibold flex-1">{title}</span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
      {open && <div className="px-2.5 pb-2.5 text-xs space-y-1.5">{children}</div>}
    </div>
  );
}

function KycInlineSummary({ company }: { company: CrmCompany }) {
  const chData = company.companiesHouseData as any;
  const kycStatus = (company as any).kycStatus;
  const storedPscs = chData?.pscs || [];
  const activePscs = storedPscs.filter((p: any) => !p.ceasedOn);
  const checkedAt = chData?.checkedAt || (company as any).kycCheckedAt;

  if (!chData && !kycStatus) return null;

  return (
    <div className="col-span-2">
      <p className="text-xs text-muted-foreground mb-1">KYC & Ownership</p>
      <div className="flex items-center gap-2 flex-wrap">
        {kycStatus === "pass" && <Badge className="text-[10px] bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 border-0"><CheckCircle2 className="w-3 h-3 mr-1" />KYC Passed</Badge>}
        {kycStatus === "warning" && <Badge className="text-[10px] bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300 border-0"><AlertCircle className="w-3 h-3 mr-1" />Needs Review</Badge>}
        {kycStatus === "fail" && <Badge className="text-[10px] bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 border-0"><XCircle className="w-3 h-3 mr-1" />KYC Failed</Badge>}
        {!kycStatus && chData && <Badge variant="outline" className="text-[10px]"><ShieldCheck className="w-3 h-3 mr-1" />Linked — not checked</Badge>}
        {checkedAt && <span className="text-[10px] text-muted-foreground">{new Date(checkedAt).toLocaleDateString("en-GB")}</span>}
      </div>
      {activePscs.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          <p className="text-[10px] text-muted-foreground">Ownership (PSCs)</p>
          <div className="flex flex-wrap gap-1">
            {activePscs.map((p: any, i: number) => (
              <Badge key={i} variant="outline" className="text-[10px] font-normal">{p.name}</Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CompaniesHouseCard({ company }: { company: CrmCompany }) {
  const { toast } = useToast();
  const chData = company.companiesHouseData as any;
  const chNumber = company.companiesHouseNumber;
  const storedKycStatus = (company as any).kycStatus;

  const [expanded, setExpanded] = useState(!!(chData || chNumber || storedKycStatus));
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CHSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [runningKyc, setRunningKyc] = useState(false);
  const [kycResult, setKycResult] = useState<any>(null);
  const [screeningResults, setScreeningResults] = useState<any>(null);
  const [runningScreening, setRunningScreening] = useState(false);

  const displayProfile = chData?.profile || chData;
  const displayNumber = chNumber;
  const storedOfficers = chData?.officers || (company as any).companiesHouseOfficers || [];
  const storedPscs = chData?.pscs || [];
  const storedFilings = chData?.filings || [];
  const checkedAt = chData?.checkedAt || (company as any).kycCheckedAt;

  const activeOfficers = (kycResult?.officers || storedOfficers).filter((o: any) => !o.resignedOn);
  const activePscs = (kycResult?.pscs || storedPscs).filter((p: any) => !p.ceasedOn);
  const filings = kycResult?.filings || storedFilings;
  const profile = kycResult?.profile || displayProfile;
  const kycStatus = kycResult?.kycStatus || storedKycStatus;
  const fetchStatus = chData?.fetchStatus;
  const hasPartialFailure = fetchStatus && Object.values(fetchStatus).some((s) => s === "failed");

  const computeRiskFactors = () => {
    const factors: Array<{ factor: string; impact: "positive" | "negative" | "neutral"; weight: number }> = [];
    let riskScore = 0;
    if (profile?.companyStatus === "active") {
      factors.push({ factor: "Company is active", impact: "positive", weight: -10 }); riskScore -= 10;
    } else if (profile) {
      factors.push({ factor: `Company status: ${profile.companyStatus || "unknown"}`, impact: "negative", weight: 30 }); riskScore += 30;
    }
    if (profile?.hasInsolvencyHistory) { factors.push({ factor: "Has insolvency history", impact: "negative", weight: 25 }); riskScore += 25; }
    else if (profile) { factors.push({ factor: "No insolvency history", impact: "positive", weight: -5 }); riskScore -= 5; }
    if (profile?.accountsOverdue) { factors.push({ factor: "Accounts overdue", impact: "negative", weight: 20 }); riskScore += 20; }
    if (profile?.confirmationStatementOverdue) { factors.push({ factor: "Confirmation statement overdue", impact: "negative", weight: 15 }); riskScore += 15; }
    if (profile?.hasCharges) { factors.push({ factor: "Has charges on file", impact: "neutral", weight: 5 }); riskScore += 5; }
    if (profile?.dateOfCreation) {
      const age = (Date.now() - new Date(profile.dateOfCreation).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      if (age < 1) { factors.push({ factor: "Company less than 1 year old", impact: "negative", weight: 15 }); riskScore += 15; }
      else if (age < 3) { factors.push({ factor: "Company less than 3 years old", impact: "neutral", weight: 5 }); riskScore += 5; }
      else { factors.push({ factor: `Company ${Math.floor(age)} years old`, impact: "positive", weight: -5 }); riskScore -= 5; }
    }
    if (activePscs.length === 0 && profile) { factors.push({ factor: "No PSCs identified — opaque ownership", impact: "negative", weight: 20 }); riskScore += 20; }
    else if (activePscs.length > 0) { factors.push({ factor: `${activePscs.length} PSC(s) identified`, impact: "positive", weight: -5 }); riskScore -= 5; }
    if (activeOfficers.length === 0 && profile) { factors.push({ factor: "No active officers found", impact: "negative", weight: 15 }); riskScore += 15; }

    const HIGH_RISK = ["russia", "belarus", "iran", "north korea", "dprk", "syria", "myanmar", "yemen", "libya", "afghanistan", "somalia"];
    const allJurisdictions = [...activeOfficers, ...activePscs].flatMap((p: any) => [p.nationality, p.countryOfResidence].filter(Boolean).map((s: string) => s.toLowerCase()));
    for (const j of allJurisdictions) {
      if (HIGH_RISK.some(h => j.includes(h))) {
        factors.push({ factor: `High-risk jurisdiction: ${j}`, impact: "negative", weight: 25 }); riskScore += 25; break;
      }
    }

    if (screeningResults?.results) {
      const strong = screeningResults.results.filter((r: any) => r.status === "strong_match").length;
      const potential = screeningResults.results.filter((r: any) => r.status === "potential_match").length;
      if (strong > 0) { factors.push({ factor: `${strong} strong sanctions match(es)`, impact: "negative", weight: 50 }); riskScore += 50; }
      else if (potential > 0) { factors.push({ factor: `${potential} potential sanctions match(es)`, impact: "negative", weight: 20 }); riskScore += 20; }
      else { factors.push({ factor: "No sanctions matches", impact: "positive", weight: -10 }); riskScore -= 10; }
    }

    const score = Math.max(0, Math.min(100, riskScore));
    const level = score >= 70 ? "critical" : score >= 40 ? "high" : score >= 20 ? "medium" : "low";
    return { score, level, factors };
  };

  const searchCH = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/companies-house/search?q=${encodeURIComponent(searchQuery)}`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Search failed");
      }
      const data = await res.json();
      setSearchResults(data.items || []);
    } catch (err: any) {
      toast({ title: "Companies House", description: err.message, variant: "destructive" });
    } finally {
      setSearching(false);
    }
  };

  const linkCompany = async (chNum: string) => {
    setLoadingProfile(true);
    try {
      const res = await fetch(`/api/companies-house/company/${chNum}`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch company profile");
      const profileData = await res.json();

      await apiRequest("PUT", `/api/crm/companies/${company.id}`, {
        companiesHouseNumber: chNum,
        companiesHouseData: profileData,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies", company.id] });
      toast({ title: "Company linked to Companies House" });
      setSearchResults([]);
      setSearchQuery("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoadingProfile(false);
    }
  };

  const unlinkCompany = async () => {
    try {
      await apiRequest("PUT", `/api/crm/companies/${company.id}`, {
        companiesHouseNumber: null,
        companiesHouseData: null,
        companiesHouseOfficers: null,
        kycStatus: null,
        kycCheckedAt: null,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies", company.id] });
      setKycResult(null);
      toast({ title: "Companies House link removed" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const runSanctionsScreening = async (officersList: any[], pscsList: any[]) => {
    setRunningScreening(true);
    try {
      const names = [
        { name: company.name || "", role: "Company" },
        ...pscsList.filter((p: any) => !p.ceasedOn).map((p: any) => ({ name: p.name, role: "PSC" })),
        ...officersList.filter((o: any) => !o.resignedOn).map((o: any) => ({ name: o.name, role: o.officerRole?.replace(/-/g, " ") || "Officer" })),
      ].filter(n => n.name.trim());

      const res = await fetch("/api/sanctions/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ names }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Screening failed");
      }
      const data = await res.json();
      setScreeningResults(data);
      return data;
    } catch (err: any) {
      toast({ title: "Sanctions Screening", description: err.message, variant: "destructive" });
      return null;
    } finally {
      setRunningScreening(false);
    }
  };

  const runKyc = async () => {
    setRunningKyc(true);
    try {
      const res = await fetch(`/api/companies-house/auto-kyc/${company.id}`, { method: "POST", credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "KYC check failed");
      }
      const data = await res.json();
      if (!data.success) {
        toast({ title: "KYC", description: data.message || "No match found", variant: "destructive" });
        return;
      }
      setKycResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies", company.id] });

      await runSanctionsScreening(data.officers || [], data.pscs || []);

      toast({ title: "KYC Report Generated", description: `Status: ${data.kycStatus === "pass" ? "Passed" : data.kycStatus === "warning" ? "Needs Review" : "Failed"}` });
    } catch (err: any) {
      toast({ title: "KYC Error", description: err.message, variant: "destructive" });
    } finally {
      setRunningKyc(false);
    }
  };

  const copyKycReport = () => {
    if (!profile) return;
    const lines: string[] = [];
    lines.push(`KYC REPORT — ${profile.companyName || company.name}`);
    lines.push(`Generated: ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`);
    lines.push(`Status: ${kycStatus === "pass" ? "PASS" : kycStatus === "warning" ? "WARNING" : "FAIL"}`);
    lines.push("");
    lines.push("COMPANY DETAILS");
    lines.push(`Company Number: ${profile.companyNumber || displayNumber}`);
    lines.push(`Status: ${profile.companyStatus}`);
    lines.push(`Type: ${profile.companyType}`);
    lines.push(`Incorporated: ${profile.dateOfCreation || "N/A"}`);
    if (profile.registeredOfficeAddress) lines.push(`Registered Address: ${formatCHAddress(profile.registeredOfficeAddress)}`);
    if (profile.sicCodes?.length) lines.push(`SIC Codes: ${profile.sicCodes.join(", ")}`);
    lines.push("");
    lines.push("COMPLIANCE FLAGS");
    lines.push(`Insolvency History: ${profile.hasInsolvencyHistory ? "YES" : "None"}`);
    lines.push(`Accounts: ${profile.accountsOverdue ? "OVERDUE" : "Up to date"}`);
    lines.push(`Confirmation Statement: ${profile.confirmationStatementOverdue ? "OVERDUE" : "Up to date"}`);
    lines.push(`Charges on File: ${profile.hasCharges ? "YES" : "None"}`);
    if (profile.lastAccountsMadeUpTo) lines.push(`Last Accounts Made Up To: ${profile.lastAccountsMadeUpTo}`);
    if (activePscs.length > 0) {
      lines.push("");
      lines.push("PERSONS WITH SIGNIFICANT CONTROL (PSCs)");
      activePscs.forEach((p: any) => {
        lines.push(`- ${p.name} (${p.nationality || "N/A"}${p.countryOfResidence ? `, ${p.countryOfResidence}` : ""})`);
        if (p.naturesOfControl?.length) lines.push(`  Control: ${p.naturesOfControl.map((c: string) => c.replace(/-/g, " ")).join("; ")}`);
        if (p.address) lines.push(`  Address: ${formatCHAddress(p.address)}`);
        if (p.notifiedOn) lines.push(`  Notified: ${p.notifiedOn}`);
      });
    }
    if (activeOfficers.length > 0) {
      lines.push("");
      lines.push("ACTIVE OFFICERS / DIRECTORS");
      activeOfficers.forEach((o: any) => {
        lines.push(`- ${o.name} — ${o.officerRole?.replace(/-/g, " ")} (appointed ${o.appointedOn || "N/A"})`);
        if (o.nationality) lines.push(`  Nationality: ${o.nationality}`);
        if (o.occupation) lines.push(`  Occupation: ${o.occupation}`);
        if (o.address) lines.push(`  Service Address: ${formatCHAddress(o.address)}`);
      });
    }
    if (filings.length > 0) {
      lines.push("");
      lines.push("RECENT FILINGS");
      filings.slice(0, 10).forEach((f: any) => {
        lines.push(`- ${f.date}: ${f.category || f.type || "Filing"} — ${f.description || "N/A"}`);
      });
    }
    if (screeningResults?.results) {
      lines.push("");
      lines.push("SANCTIONS SCREENING (UK Sanctions List — FCDO)");
      lines.push(`Overall: ${screeningResults.overallStatus === "clear" ? "ALL CLEAR" : screeningResults.overallStatus === "review" ? "POTENTIAL MATCHES — REVIEW REQUIRED" : "ALERT — MATCHES FOUND"}`);
      for (const r of screeningResults.results) {
        lines.push(`- ${r.name} (${r.role}): ${r.status === "clear" ? "Clear" : r.status === "strong_match" ? "STRONG MATCH" : "Potential match"}`);
        if (r.matches?.length > 0) {
          for (const m of r.matches) {
            lines.push(`  → ${m.sanctionedName} (${m.matchScore}% match) — ${m.regime} — ${m.sanctionsImposed}`);
          }
        }
      }
    }
    lines.push("");
    lines.push("RISK ASSESSMENT");
    const riskFactors = computeRiskFactors();
    lines.push(`Risk Level: ${riskFactors.level.toUpperCase()} (Score: ${riskFactors.score}/100)`);
    riskFactors.factors.forEach(f => {
      lines.push(`  ${f.impact === "negative" ? "[-]" : f.impact === "positive" ? "[+]" : "[~]"} ${f.factor}`);
    });
    lines.push("");
    lines.push("---");
    lines.push("Sources: Companies House, UK Sanctions List (FCDO)");
    lines.push("This report is auto-generated from public data for AML/KYC compliance.");

    navigator.clipboard.writeText(lines.join("\n"));
    toast({ title: "KYC Report Copied", description: "Full compliance report copied to clipboard" });
  };

  return (
    <Card data-testid="card-companies-house">
      <CardContent className="p-3 space-y-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center justify-between w-full text-left"
          data-testid="button-kyc-toggle"
        >
          <h3 className="font-semibold text-xs flex items-center gap-1.5">
            {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
            <ShieldCheck className="w-3.5 h-3.5" />
            KYC Full Report
          </h3>
          <div className="flex items-center gap-1">
            {kycStatus === "pass" && <Badge className="text-[9px] bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 border-0">Passed</Badge>}
            {kycStatus === "warning" && <Badge className="text-[9px] bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300 border-0">Review</Badge>}
            {kycStatus === "fail" && <Badge className="text-[9px] bg-red-100 text-red-700 border-0">Failed</Badge>}
          </div>
        </button>

        {!expanded ? null : !displayNumber ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Link to Companies House to run KYC checks, or click "Run KYC" to auto-match by name.</p>
            <div className="flex gap-2">
              <Button
                variant="default"
                size="sm"
                className="h-8 text-xs gap-1"
                onClick={runKyc}
                disabled={runningKyc}
                data-testid="button-run-kyc-auto"
              >
                {runningKyc ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                Run KYC
              </Button>
            </div>
            <div className="border-t pt-2 mt-2">
              <p className="text-[11px] text-muted-foreground mb-1.5">Or search manually:</p>
              <form onSubmit={(e) => { e.preventDefault(); searchCH(); }} className="flex gap-2">
                <Input
                  placeholder="Search by name or number..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="text-xs h-8"
                  data-testid="input-ch-search"
                />
                <Button type="submit" size="sm" disabled={searching || !searchQuery.trim()} className="h-8 text-xs" data-testid="button-ch-search">
                  {searching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                </Button>
              </form>
              {searchResults.length > 0 && (
                <div className="border rounded-md max-h-[200px] overflow-y-auto mt-2">
                  {searchResults.map((r) => (
                    <button
                      key={r.companyNumber}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-muted border-b last:border-b-0 transition-colors"
                      onClick={() => linkCompany(r.companyNumber)}
                      disabled={loadingProfile}
                      data-testid={`button-ch-result-${r.companyNumber}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{r.title}</span>
                        <Badge variant={r.companyStatus === "active" ? "default" : "secondary"} className="text-[9px] ml-2">{r.companyStatus}</Badge>
                      </div>
                      <div className="text-muted-foreground mt-0.5">{r.companyNumber} · {r.addressSnippet || "No address"}</div>
                    </button>
                  ))}
                </div>
              )}
              {loadingProfile && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Loading company profile...</span>
                </div>
              )}
            </div>
          </div>
        ) : profile ? (
          <ScrollArea className="max-h-[250px] overflow-y-auto">
            <div className="space-y-2 pr-3">
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/30">
                {kycStatus === "pass" && <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />}
                {kycStatus === "warning" && <AlertCircle className="w-5 h-5 text-yellow-500 shrink-0" />}
                {kycStatus === "fail" && <XCircle className="w-5 h-5 text-red-500 shrink-0" />}
                {!kycStatus && <ShieldCheck className="w-5 h-5 text-muted-foreground shrink-0" />}
                <div>
                  <p className="text-sm font-semibold">
                    {kycStatus === "pass" ? "KYC Passed" : kycStatus === "warning" ? "Needs Review" : kycStatus === "fail" ? "KYC Failed" : "Linked — Run KYC to verify"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {checkedAt ? `Checked ${new Date(checkedAt).toLocaleDateString("en-GB")}` : "Not yet checked"} · Forward to{" "}
                    <a href="https://kyc4u.co.uk" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">KYC4U</a> for full verification
                  </p>
                </div>
              </div>

              <div className="flex gap-1">
                <Button variant="default" size="sm" className="h-6 text-[10px] gap-1" onClick={runKyc} disabled={runningKyc} data-testid="button-run-kyc">
                  {runningKyc ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                  Run KYC
                </Button>
                {profile && (
                  <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={copyKycReport} data-testid="button-copy-kyc">
                    <Copy className="w-3 h-3" />
                    Copy Report
                  </Button>
                )}
              </div>

              {hasPartialFailure && (
                <div className="flex items-center gap-2 p-2 rounded bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 text-[11px]">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>Partial report — some data sources were unavailable. Re-run KYC to retry.</span>
                </div>
              )}

              <KycSection title="Company Details" icon={Building2} defaultOpen>
                <div className="space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Company No.</span>
                    <a href={`https://find-and-update.company-information.service.gov.uk/company/${displayNumber}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1" data-testid="link-ch-profile">
                      {displayNumber} <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Status</span>
                    <Badge variant={profile.companyStatus === "active" ? "default" : "destructive"} className="text-[10px]">{profile.companyStatus}</Badge>
                  </div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span>{profile.companyType}</span></div>
                  {profile.dateOfCreation && <div className="flex justify-between"><span className="text-muted-foreground">Incorporated</span><span>{profile.dateOfCreation}</span></div>}
                  {profile.sicCodes?.length > 0 && <div className="flex justify-between"><span className="text-muted-foreground">SIC Codes</span><span>{profile.sicCodes.join(", ")}</span></div>}
                  {profile.registeredOfficeAddress && <div><span className="text-muted-foreground">Registered Address</span><p className="mt-0.5">{formatCHAddress(profile.registeredOfficeAddress)}</p></div>}
                  {profile.lastAccountsMadeUpTo && <div className="flex justify-between"><span className="text-muted-foreground">Last Accounts</span><span>{profile.lastAccountsMadeUpTo}</span></div>}
                </div>
              </KycSection>

              <KycSection title="Compliance Flags" icon={ShieldCheck} defaultOpen>
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    {profile.hasInsolvencyHistory ? <XCircle className="w-3 h-3 text-red-500" /> : <CheckCircle2 className="w-3 h-3 text-green-500" />}
                    <span>Insolvency: {profile.hasInsolvencyHistory ? "Yes — FLAGGED" : "None"}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {profile.accountsOverdue ? <XCircle className="w-3 h-3 text-red-500" /> : <CheckCircle2 className="w-3 h-3 text-green-500" />}
                    <span>Accounts: {profile.accountsOverdue ? "OVERDUE" : "Up to date"}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {profile.confirmationStatementOverdue ? <AlertCircle className="w-3 h-3 text-yellow-500" /> : <CheckCircle2 className="w-3 h-3 text-green-500" />}
                    <span>Confirmation Statement: {profile.confirmationStatementOverdue ? "OVERDUE" : "Up to date"}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {profile.hasCharges ? <AlertCircle className="w-3 h-3 text-yellow-500" /> : <CheckCircle2 className="w-3 h-3 text-green-500" />}
                    <span>Charges: {profile.hasCharges ? "Has charges on file" : "None"}</span>
                  </div>
                </div>
              </KycSection>

              {activePscs.length > 0 && (
                <KycSection title={`Persons with Significant Control (${activePscs.length})`} icon={UserCheck} defaultOpen>
                  <div className="space-y-2">
                    {activePscs.map((p: any, i: number) => (
                      <div key={i} className="p-2 bg-muted/30 rounded space-y-0.5">
                        <p className="font-semibold">{p.name}</p>
                        <p className="text-muted-foreground">{p.nationality}{p.countryOfResidence ? ` · ${p.countryOfResidence}` : ""}</p>
                        {p.naturesOfControl?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {p.naturesOfControl.map((c: string, j: number) => (
                              <Badge key={j} variant="secondary" className="text-[9px] font-normal">{c.replace(/-/g, " ").replace(/ownership-of-shares-/g, "").replace(/voting-rights-/g, "votes ")}</Badge>
                            ))}
                          </div>
                        )}
                        {p.address && <p className="text-muted-foreground">{formatCHAddress(p.address)}</p>}
                        {p.notifiedOn && <p className="text-muted-foreground">Notified: {p.notifiedOn}</p>}
                      </div>
                    ))}
                  </div>
                </KycSection>
              )}

              {activeOfficers.length > 0 && (
                <KycSection title={`Officers & Directors (${activeOfficers.length})`} icon={Users}>
                  <div className="space-y-2">
                    {activeOfficers.map((o: any, i: number) => (
                      <div key={i} className="p-2 bg-muted/30 rounded space-y-0.5">
                        <div className="flex items-center justify-between">
                          <p className="font-semibold">{o.name}</p>
                          <Badge variant="outline" className="text-[9px]">{o.officerRole?.replace(/-/g, " ")}</Badge>
                        </div>
                        {o.nationality && <p className="text-muted-foreground">Nationality: {o.nationality}</p>}
                        {o.occupation && <p className="text-muted-foreground">Occupation: {o.occupation}</p>}
                        {o.appointedOn && <p className="text-muted-foreground">Appointed: {o.appointedOn}</p>}
                        {o.address && <p className="text-muted-foreground">{formatCHAddress(o.address)}</p>}
                      </div>
                    ))}
                  </div>
                </KycSection>
              )}

              {filings.length > 0 && (
                <KycSection title="Recent Filings" icon={FileSearch}>
                  <div className="space-y-1">
                    {filings.slice(0, 10).map((f: any, i: number) => (
                      <div key={i} className="flex justify-between p-1.5 bg-muted/30 rounded">
                        <span>{f.category || f.type || "Filing"}: {f.description || "N/A"}</span>
                        <span className="text-muted-foreground shrink-0 ml-2">{f.date}</span>
                      </div>
                    ))}
                  </div>
                </KycSection>
              )}

              <KycSection title="Sanctions Screening (UK Sanctions List)" icon={ShieldCheck} defaultOpen={!!screeningResults}>
                {screeningResults ? (
                  <div className="space-y-2">
                    <div className={`flex items-center gap-2 p-2 rounded ${
                      screeningResults.overallStatus === "clear" ? "bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200" :
                      screeningResults.overallStatus === "review" ? "bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200" :
                      "bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200"
                    }`}>
                      {screeningResults.overallStatus === "clear" ? <CheckCircle2 className="w-4 h-4 shrink-0" /> :
                       screeningResults.overallStatus === "review" ? <AlertCircle className="w-4 h-4 shrink-0" /> :
                       <XCircle className="w-4 h-4 shrink-0" />}
                      <span className="font-semibold">
                        {screeningResults.overallStatus === "clear" ? "All Clear — No sanctions matches" :
                         screeningResults.overallStatus === "review" ? "Review Required — Potential matches found" :
                         "ALERT — Strong sanctions matches found"}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Screened {screeningResults.results?.length || 0} name(s) against {screeningResults.totalEntries?.toLocaleString() || "N/A"} entries · {screeningResults.screenedAt ? new Date(screeningResults.screenedAt).toLocaleDateString("en-GB") : ""}
                    </p>
                    {screeningResults.results?.map((r: any, i: number) => (
                      <div key={i} className="p-2 bg-muted/30 rounded space-y-0.5">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">{r.name}</span>
                          <div className="flex items-center gap-1">
                            <Badge variant="outline" className="text-[9px]">{r.role}</Badge>
                            {r.status === "clear" && <Badge className="text-[9px] bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Clear</Badge>}
                            {r.status === "potential_match" && <Badge className="text-[9px] bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">Review</Badge>}
                            {r.status === "strong_match" && <Badge className="text-[9px] bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">Match</Badge>}
                          </div>
                        </div>
                        {r.matches?.length > 0 && r.matches.map((m: any, j: number) => (
                          <div key={j} className="ml-2 mt-1 p-1.5 bg-red-50 dark:bg-red-900/10 rounded text-[11px]">
                            <p className="font-medium">→ {m.sanctionedName} ({m.matchScore}% match)</p>
                            <p className="text-muted-foreground">{m.regime}</p>
                            <p className="text-muted-foreground">{m.sanctionsImposed}</p>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-muted-foreground text-[11px]">Screen all PSCs, officers and the company against the official UK Sanctions List (FCDO).</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs gap-1"
                      onClick={() => runSanctionsScreening(activeOfficers, activePscs)}
                      disabled={runningScreening}
                      data-testid="button-run-screening"
                    >
                      {runningScreening ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                      Run Sanctions Screening
                    </Button>
                  </div>
                )}
              </KycSection>

              {profile && (() => {
                const risk = computeRiskFactors();
                const riskColor = risk.level === "low" ? "green" : risk.level === "medium" ? "yellow" : risk.level === "high" ? "orange" : "red";
                return (
                  <KycSection title={`Risk Assessment — ${risk.level.toUpperCase()} (${risk.score}/100)`} icon={AlertCircle} defaultOpen>
                    <div className="space-y-2">
                      <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            risk.level === "low" ? "bg-green-500" : risk.level === "medium" ? "bg-yellow-500" : risk.level === "high" ? "bg-orange-500" : "bg-red-500"
                          }`}
                          style={{ width: `${risk.score}%` }}
                        />
                      </div>
                      <div className="space-y-1">
                        {risk.factors.map((f, i) => (
                          <div key={i} className="flex items-center gap-1.5">
                            {f.impact === "positive" ? <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" /> :
                             f.impact === "negative" ? <XCircle className="w-3 h-3 text-red-500 shrink-0" /> :
                             <Circle className="w-3 h-3 text-muted-foreground shrink-0" />}
                            <span>{f.factor}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </KycSection>
                );
              })()}

              <div className="border-t pt-2 flex gap-2">
                <Button variant="outline" size="sm" className="text-xs flex-1" onClick={unlinkCompany} data-testid="button-unlink-ch">
                  <X className="w-3 h-3 mr-1" />
                  Remove Link
                </Button>
              </div>
            </div>
          </ScrollArea>
        ) : (
          <div className="text-center py-4 text-muted-foreground text-xs">
            <ShieldCheck className="w-6 h-6 mx-auto mb-2 opacity-30" />
            <p>Click "Run KYC" to generate a report</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}


function CompanyFormDialog({
  open,
  onOpenChange,
  company,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company?: CrmCompany | null;
}) {
  const { toast } = useToast();
  const isEdit = !!company;
  const [formData, setFormData] = useState({
    name: company?.name || "",
    companyType: company?.companyType || "",
    domain: company?.domain || "",
    domainUrl: company?.domainUrl || "",
    description: company?.description || "",
    companyProfileUrl: company?.companyProfileUrl || "",
  });

  const [aiLoading, setAiLoading] = useState(false);

  const generateDescription = async () => {
    if (!formData.name.trim()) return;
    setAiLoading(true);
    try {
      const res = await apiRequest("POST", "/api/crm/companies/ai-description", {
        name: formData.name,
        companyType: formData.companyType,
        domain: formData.domain,
      });
      const data = await res.json();
      if (data.description) {
        setFormData((prev) => ({ ...prev, description: data.description }));
      }
    } catch (err: any) {
      toast({ title: "AI Error", description: err.message, variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
  };

  const mutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (isEdit) {
        await apiRequest("PUT", `/api/crm/companies/${company.id}`, data);
      } else {
        await apiRequest("POST", "/api/crm/companies", data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      toast({ title: isEdit ? "Company updated" : "Company created" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;
    mutation.mutate(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[540px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Company" : "New Company"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update company details" : "Add a new company to the CRM"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="company-name" className="text-xs font-medium">Name</Label>
            <Input
              id="company-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              data-testid="input-company-name"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-medium">Type</Label>
            <Select value={formData.companyType || undefined} onValueChange={(v) => setFormData({ ...formData, companyType: v === "__clear__" ? "" : v })}>
              <SelectTrigger data-testid="select-company-type">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__clear__" className="text-muted-foreground">None</SelectItem>
                {CRM_OPTIONS.companyType.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-medium">Website</Label>
            <Input
              value={formData.domainUrl}
              onChange={(e) => setFormData({ ...formData, domainUrl: e.target.value, domain: e.target.value.replace(/^https?:\/\//, "").replace(/\/$/, "") })}
              placeholder="https://www.example.com"
              data-testid="input-company-domain-url"
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">Description</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={generateDescription}
                disabled={aiLoading || !formData.name.trim()}
                data-testid="button-ai-description"
              >
                {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {aiLoading ? "Generating..." : "AI Generate"}
              </Button>
            </div>
            <Textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="min-h-[80px] resize-y"
              data-testid="textarea-company-description"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-company-cancel">Cancel</Button>
            <Button type="submit" disabled={mutation.isPending || !formData.name.trim()} data-testid="button-company-save">
              {mutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : isEdit ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}


function getCompanyBgpContacts(company: CrmCompany): string[] {
  return company.bgpContactUserIds && company.bgpContactUserIds.length > 0
    ? company.bgpContactUserIds
    : company.bgpContactCrm ? [company.bgpContactCrm] : [];
}

function CompanyKycSummaryCard({ company, relatedDeals, propertyMap }: { company: CrmCompany; relatedDeals: CrmDeal[]; propertyMap: Map<string, CrmProperty> }) {
  const kycStatus = (company as any).kycStatus;
  const chData = company.companiesHouseData as any;
  const checkedAt = chData?.checkedAt || (company as any).kycCheckedAt;
  const amlChecklist = (company as any).amlChecklist as Record<string, boolean> | null;
  const checklistTotal = 12;
  const checklistDone = amlChecklist ? Object.values(amlChecklist).filter(Boolean).length : 0;

  const dealRoles = relatedDeals.map(deal => {
    const roles: string[] = [];
    if (deal.tenantId === company.id) roles.push("Tenant");
    if (deal.landlordId === company.id) roles.push("Landlord");
    if (deal.vendorId === company.id) roles.push("Vendor");
    if (deal.purchaserId === company.id) roles.push("Purchaser");
    if (deal.invoicingEntityId === company.id && roles.length === 0) roles.push("Invoicing Entity");
    if (roles.length === 0) roles.push("Linked");
    const prop = deal.propertyId ? propertyMap.get(deal.propertyId) : null;
    return { deal, roles, property: prop };
  });

  return (
    <Card data-testid="company-kyc-summary">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5" />
            <h3 className="text-xs font-semibold">AML / KYC Compliance</h3>
            {kycStatus === "pass" ? (
              <Badge className="text-[9px] bg-green-600 text-white">Verified</Badge>
            ) : kycStatus === "warning" ? (
              <Badge className="text-[9px] bg-amber-500 text-white">Review</Badge>
            ) : kycStatus === "fail" ? (
              <Badge className="text-[9px] bg-red-500 text-white">Failed</Badge>
            ) : (
              <Badge variant="outline" className="text-[9px] text-muted-foreground">Not Checked</Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            {checkedAt && <span>Checked {new Date(checkedAt).toLocaleDateString("en-GB")}</span>}
            {amlChecklist && <span>Checklist {checklistDone}/{checklistTotal}</span>}
          </div>
        </div>

        {dealRoles.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground font-medium">Linked Deals</p>
            {dealRoles.map(({ deal, roles, property }) => (
              <div key={deal.id} className="flex items-center justify-between py-1.5 px-2 rounded border bg-muted/20">
                <div className="flex items-center gap-2 min-w-0">
                  <Handshake className="w-3 h-3 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <Link href={`/deals/${deal.id}`}>
                      <span className="text-xs font-medium hover:underline cursor-pointer truncate block">{deal.name}</span>
                    </Link>
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-[10px] text-muted-foreground">{roles.join(", ")}</span>
                      {property && (
                        <span className="text-[10px] text-muted-foreground">
                          — <Link href={`/properties/${property.id}`}><span className="hover:underline cursor-pointer">{property.name}</span></Link>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {deal.dealType && (
                  <Badge variant="secondary" className="text-[8px] shrink-0">{deal.dealType}</Badge>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="pt-2 border-t flex items-center justify-between">
          <Link href="/compliance-board">
            <span className="text-[11px] text-primary hover:underline cursor-pointer flex items-center gap-1" data-testid="link-company-compliance-board">
              <ShieldCheck className="w-3 h-3" /> View full KYC pack on Compliance Board
            </span>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function CompanyDetail({ id }: { id: string }) {
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);

  const { data: company, isLoading } = useQuery<CrmCompany>({
    queryKey: ["/api/crm/companies", id],
  });

  const { data: allUsers } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/users"],
  });

  const userColorMap = useMemo(() => buildUserColorMap(allUsers), [allUsers]);

  const { data: relatedContacts } = useQuery<CrmContact[]>({
    queryKey: ["/api/crm/contacts", { companyId: id }],
    queryFn: async () => {
      const res = await fetch(`/api/crm/contacts?companyId=${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch contacts");
      return res.json();
    },
  });

  const { data: allDeals } = useQuery<CrmDeal[]>({
    queryKey: ["/api/crm/deals"],
  });

  const { data: allProperties } = useQuery<CrmProperty[]>({
    queryKey: ["/api/crm/properties"],
  });

  const { data: companyPropertyLinks } = useQuery<{ companyId: string; propertyId: string }[]>({
    queryKey: ["/api/crm/company-property-links"],
  });

  const { data: companyDealLinksForDetail } = useQuery<{ companyId: string; dealId: string }[]>({
    queryKey: ["/api/crm/company-deal-links"],
  });

  const { data: propertyAgentLinks = [] } = useQuery<{ propertyId: string; userId: string }[]>({
    queryKey: ["/api/crm/property-agents"],
  });

  const linkedProperties = useMemo(() => {
    if (!companyPropertyLinks || !allProperties) return [];
    const linkedIds = companyPropertyLinks.filter(l => l.companyId === id).map(l => l.propertyId);
    return allProperties.filter(p => linkedIds.includes(p.id));
  }, [companyPropertyLinks, allProperties, id]);

  useEffect(() => {
    if (company) {
      trackRecentItem({ id: company.id, type: "company", name: company.name || "Untitled Company", subtitle: company.companyType || undefined });
    }
  }, [company?.id, company?.name, company?.companyType]);

  const relatedDeals = useMemo(() => {
    if (!allDeals) return [];
    const directDeals = allDeals.filter(d => d.landlordId === id || d.tenantId === id || d.vendorId === id || d.purchaserId === id || d.invoicingEntityId === id);
    const directIds = new Set(directDeals.map(d => d.id));
    const linkedDealIds = (companyDealLinksForDetail || []).filter(l => l.companyId === id).map(l => l.dealId);
    const linkedDeals = allDeals.filter(d => linkedDealIds.includes(d.id) && !directIds.has(d.id));
    return [...directDeals, ...linkedDeals];
  }, [allDeals, id, companyDealLinksForDetail]);

  const propertyMap = useMemo(() => {
    if (!allProperties) return new Map<string, CrmProperty>();
    return new Map(allProperties.map(p => [p.id, p]));
  }, [allProperties]);

  const propertiesWithDeals = useMemo(() => {
    const grouped = new Map<string, { property: CrmProperty; deals: CrmDeal[] }>();
    const unlinkedDeals: CrmDeal[] = [];
    for (const deal of relatedDeals) {
      if (deal.propertyId && propertyMap.has(deal.propertyId)) {
        const existing = grouped.get(deal.propertyId);
        if (existing) {
          existing.deals.push(deal);
        } else {
          grouped.set(deal.propertyId, { property: propertyMap.get(deal.propertyId)!, deals: [deal] });
        }
      } else {
        unlinkedDeals.push(deal);
      }
    }
    return { grouped: Array.from(grouped.values()), unlinkedDeals };
  }, [relatedDeals, propertyMap]);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/crm/companies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      toast({ title: "Company deleted" });
      window.history.back();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const aiToggleMutation = useMutation({
    mutationFn: async (disabled: boolean) => {
      await apiRequest("PUT", `/api/crm/companies/${id}`, { aiDisabled: disabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      toast({ title: company?.aiDisabled ? "AI access enabled" : "AI access disabled for this company" });
    },
  });

  const enrichCompanyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/apollo/enrich-company", { companyId: id });
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ["/api/crm/companies", id] });
        queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
        if (data.updatedFields?.length > 0) {
          toast({ title: "Company enriched", description: `Updated: ${data.updatedFields.join(", ")}` });
        } else {
          toast({ title: "Already enriched", description: "All available data already present on this company" });
        }
      } else {
        toast({ title: "No match found", description: "Apollo couldn't find this company — try adding a domain or website", variant: "destructive" });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Enrichment failed", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[300px]" />
      </div>
    );
  }

  if (!company) {
    return (
      <div className="p-4 sm:p-6">
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <h3 className="font-medium mb-1">Company not found</h3>
          </CardContent>
        </Card>
      </div>
    );
  }

  const address = company.headOfficeAddress as Record<string, string> | null;
  const addressText = address ? [address.street, address.city, address.country].filter(Boolean).join(", ") : "";

  return (
    <div className="p-4 sm:p-6 space-y-6" data-testid="company-detail">
      <CompanyFormDialog open={editOpen} onOpenChange={setEditOpen} company={company} />

      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/companies">
          <Button variant="ghost" size="sm" data-testid="button-back-companies">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
        </Link>
        <CompanyLogoImg domain={company.domainUrl || company.domain} name={company.name} size={40} />
        <div className="flex-1">
          <h1 className="text-xl font-bold" data-testid="text-company-detail-name">{company.name}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {company.companyType && <Badge variant="secondary" className="text-xs">{company.companyType}</Badge>}
            {company.aiDisabled && (
              <Badge variant="outline" className="text-[10px] border-red-300 text-red-700 bg-red-50" data-testid="badge-ai-disabled">
                <BotOff className="w-2.5 h-2.5 mr-0.5" />AI Disabled
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => enrichCompanyMutation.mutate()}
            disabled={enrichCompanyMutation.isPending}
            data-testid="button-enrich-company"
          >
            {enrichCompanyMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Zap className="w-4 h-4 mr-1" />}
            Enrich
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const newState = !company.aiDisabled;
              const msg = newState
                ? "Disable AI for this company? ChatBGP will no longer access or return this company's data."
                : "Re-enable AI access for this company?";
              if (confirm(msg)) aiToggleMutation.mutate(newState);
            }}
            className={company.aiDisabled ? "border-red-300 text-red-700" : ""}
            data-testid="button-toggle-ai"
          >
            {company.aiDisabled ? <><BotOff className="w-4 h-4 mr-1" />AI Off</> : <><Bot className="w-4 h-4 mr-1" />AI On</>}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} data-testid="button-edit-company">
            <Pencil className="w-4 h-4 mr-1" />
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (confirm("Delete this company?")) deleteMutation.mutate();
            }}
            data-testid="button-delete-company"
          >
            <Trash2 className="w-4 h-4 mr-1" />
            Delete
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardContent className="p-3 space-y-2">
              <h3 className="font-semibold text-xs">Details</h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                {(company.domainUrl || company.domain) && (
                  <div>
                    <p className="text-xs text-muted-foreground">Website</p>
                    {company.domainUrl ? (
                      <a href={company.domainUrl.startsWith("http") ? company.domainUrl : `https://${company.domainUrl}`} target="_blank" rel="noopener noreferrer" className="text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-1" data-testid="link-company-website">
                        <Globe className="w-3 h-3 text-teal-500" />{company.domainUrl.replace(/^https?:\/\//, "")}
                      </a>
                    ) : (
                      <p data-testid="text-company-domain">{company.domain}</p>
                    )}
                  </div>
                )}
                {getCompanyBgpContacts(company).length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground">BGP Contacts</p>
                    <div className="flex flex-wrap gap-1 mt-0.5" data-testid="text-company-bgp-contacts">
                      {getCompanyBgpContacts(company).map((name: string) => (
                        <Badge key={name} className={`text-[10px] px-1.5 py-0 text-white ${userColorMap[name] || "bg-zinc-500"}`}>{name}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {addressText && (
                  <div>
                    <p className="text-xs text-muted-foreground">Address</p>
                    <p className="flex items-center gap-1" data-testid="text-company-address"><MapPin className="w-3 h-3 text-teal-500" />{addressText}</p>
                  </div>
                )}
                {company.linkedinUrl && (
                  <div>
                    <p className="text-xs text-muted-foreground">LinkedIn</p>
                    <a href={company.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-1" data-testid="link-company-linkedin">
                      <Linkedin className="w-3 h-3 text-teal-500" />Profile
                    </a>
                  </div>
                )}
                {company.phone && (
                  <div>
                    <p className="text-xs text-muted-foreground">Phone</p>
                    <p className="flex items-center gap-1" data-testid="text-company-phone"><Phone className="w-3 h-3 text-teal-500" />{company.phone}</p>
                  </div>
                )}
                {company.industry && (
                  <div>
                    <p className="text-xs text-muted-foreground">Industry</p>
                    <p className="flex items-center gap-1" data-testid="text-company-industry"><Factory className="w-3 h-3 text-teal-500" />{company.industry}</p>
                  </div>
                )}
                {company.employeeCount && (
                  <div>
                    <p className="text-xs text-muted-foreground">Employees</p>
                    <p className="flex items-center gap-1" data-testid="text-company-employees"><UsersRound className="w-3 h-3 text-teal-500" />{Number(company.employeeCount).toLocaleString()}</p>
                  </div>
                )}
                {company.annualRevenue && (
                  <div>
                    <p className="text-xs text-muted-foreground">Annual Revenue</p>
                    <p className="flex items-center gap-1" data-testid="text-company-revenue">£{Number(company.annualRevenue).toLocaleString()}</p>
                  </div>
                )}
                {company.foundedYear && (
                  <div>
                    <p className="text-xs text-muted-foreground">Founded</p>
                    <p className="flex items-center gap-1" data-testid="text-company-founded"><CalendarDays className="w-3 h-3 text-teal-500" />{company.foundedYear}</p>
                  </div>
                )}
                <KycInlineSummary company={company} />
              </div>
              {company.description && (
                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground mb-1">Description</p>
                  <p className="text-sm" data-testid="text-company-description">{company.description}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <BrandProfilePanel companyId={id} />

          {linkedProperties.length > 0 && (() => {
            const userIdToName = new Map<string, string>();
            if (allUsers) {
              for (const u of allUsers) {
                userIdToName.set(u.id, u.name);
              }
            }
            return (
            <Card>
              <CardContent className="p-3 space-y-2">
                <h3 className="font-semibold text-xs flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-teal-500" />
                  Linked Properties ({linkedProperties.length})
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-[300px] overflow-y-auto">
                  {linkedProperties.map((property) => {
                    const agentUserIds = propertyAgentLinks.filter(l => l.propertyId === property.id).map(l => l.userId);
                    const agentNames = agentUserIds.map(uid => userIdToName.get(uid)).filter(Boolean) as string[];
                    const isLeasing = property.status === "Leasing Instruction";
                    return (
                    <Link key={property.id} href={`/properties/${property.id}`}>
                      <div className={`flex flex-col p-2 rounded-md transition-colors cursor-pointer ${isLeasing ? "border border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-900/10 hover:bg-green-50 dark:hover:bg-green-900/20" : "border border-purple-300 dark:border-purple-700 bg-purple-50/50 dark:bg-purple-900/10 hover:bg-purple-50 dark:hover:bg-purple-900/20"}`} data-testid={`link-property-${property.id}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isLeasing ? "bg-green-500" : "bg-purple-500"}`} />
                          <p className="text-sm font-medium truncate text-zinc-800 dark:text-zinc-200">{property.name}</p>
                        </div>
                        {agentNames.length > 0 && (
                          <div className="flex flex-wrap gap-0.5 mt-1 ml-4">
                            {agentNames.map((name) => (
                              <Badge key={name} className={`text-[9px] px-1 py-0 text-white ${userColorMap[name] || "bg-zinc-500"}`}>{name.split(" ")[0]}</Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </Link>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
            );
          })()}

          <Card>
            <CardContent className="p-3">
              <CompanyLeasingScheduleSection companyId={id} />
            </CardContent>
          </Card>

        </div>

        <div className="space-y-3 flex flex-col">
          <Card className="flex-1">
            <CardContent className="p-3 space-y-2">
              <h3 className="font-semibold text-xs flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-teal-500" />
                Contacts ({relatedContacts?.length || 0})
              </h3>
              {relatedContacts && relatedContacts.length > 0 ? (
                <ScrollArea className="max-h-[400px] overflow-y-auto">
                  <div className="space-y-0.5 pr-2">
                    {relatedContacts.map((contact) => (
                      <Link key={contact.id} href={`/contacts/${contact.id}`}>
                        <div className="flex items-center gap-2 px-2 py-1 rounded hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors cursor-pointer" data-testid={`link-contact-${contact.id}`}>
                          {contact.avatarUrl ? (
                            <img src={contact.avatarUrl} alt={contact.name} className="w-6 h-6 rounded-full flex-shrink-0 bg-muted" />
                          ) : (
                            <div className="w-6 h-6 rounded-full flex-shrink-0 bg-teal-100 dark:bg-teal-900 flex items-center justify-center text-[10px] font-semibold text-teal-700 dark:text-teal-300">
                              {contact.name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <p className="text-xs font-medium text-teal-700 dark:text-teal-300">{contact.name}</p>
                            <p className="text-[10px] text-muted-foreground">{contact.role || contact.email}</p>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <p className="text-xs text-muted-foreground">No contacts linked</p>
              )}
            </CardContent>
          </Card>

          <CompaniesHouseCard company={company} />

          <CompanyFoldersCard companyName={company.name} linkedProperties={linkedProperties} />
        </div>

        <div className="lg:col-span-3">
          <CompanyKycSummaryCard company={company} relatedDeals={relatedDeals} propertyMap={propertyMap} />
        </div>

        {(propertiesWithDeals.grouped.length > 0 || propertiesWithDeals.unlinkedDeals.length > 0) && (
          <Card className="lg:col-span-3">
            <CardContent className="p-3 space-y-3">
              <h3 className="font-semibold text-xs flex items-center gap-1.5">
                <Handshake className="w-3.5 h-3.5 text-teal-500" />
                Properties & Deals ({relatedDeals.length} deal{relatedDeals.length !== 1 ? "s" : ""} across {propertiesWithDeals.grouped.length} propert{propertiesWithDeals.grouped.length !== 1 ? "ies" : "y"})
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {propertiesWithDeals.grouped.map(({ property, deals }) => (
                  <div key={property.id} className="border rounded-lg overflow-hidden" data-testid={`property-group-${property.id}`}>
                    <Link href={`/properties/${property.id}`}>
                      <div className="flex items-center gap-2 p-2 bg-teal-50 dark:bg-teal-900/20 hover:bg-teal-100 dark:hover:bg-teal-900/30 transition-colors cursor-pointer border-b border-teal-100 dark:border-teal-800">
                        <Building className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate text-teal-700 dark:text-teal-300">{property.name}</p>
                        </div>
                        <Badge className="text-[9px] shrink-0 bg-teal-100 text-teal-700 dark:bg-teal-800 dark:text-teal-300 border-0">{deals.length} deal{deals.length !== 1 ? "s" : ""}</Badge>
                      </div>
                    </Link>
                    <div className="divide-y max-h-[150px] overflow-y-auto">
                      {deals.map((deal) => (
                        <Link key={deal.id} href={`/deals/${deal.id}`}>
                          <div className="flex items-center justify-between px-2 py-1.5 hover:bg-muted/30 transition-colors cursor-pointer" data-testid={`link-deal-${deal.id}`}>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs truncate">{deal.name}</p>
                              <p className="text-[10px] text-muted-foreground">{deal.status || deal.groupName}</p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {deal.dealType && (
                                <Badge variant="secondary" className={`text-[9px] ${deal.dealType === "Leasing" ? "bg-teal-100 text-teal-700 dark:bg-teal-800 dark:text-teal-300" : ""}`}>{deal.dealType}</Badge>
                              )}
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {propertiesWithDeals.unlinkedDeals.length > 0 && (
                <div className="border rounded-lg overflow-hidden" data-testid="unlinked-deals-group">
                  <div className="flex items-center gap-2 p-2 bg-muted/50">
                    <Handshake className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <p className="text-xs font-medium">Other Deals (no property linked)</p>
                    <Badge variant="outline" className="text-[10px] shrink-0 ml-auto">{propertiesWithDeals.unlinkedDeals.length}</Badge>
                  </div>
                  <div className="divide-y max-h-[150px] overflow-y-auto">
                    {propertiesWithDeals.unlinkedDeals.map((deal) => (
                      <Link key={deal.id} href={`/deals/${deal.id}`}>
                        <div className="flex items-center justify-between px-2 py-1.5 pl-7 hover:bg-muted/30 transition-colors cursor-pointer" data-testid={`link-deal-${deal.id}`}>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs truncate">{deal.name}</p>
                            <p className="text-[10px] text-muted-foreground">{deal.status || deal.groupName}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {deal.dealType && <Badge variant="secondary" className="text-[9px]">{deal.dealType}</Badge>}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

const COMPANY_TEMPLATES = [
  { value: "Leasing", label: "Leasing", folders: ["Crib Sheets", "Brochures", "Leasing Plans", "Fee Agreement", "General Landsec Documents", "Monthly Trading Updates"] },
  { value: "Investment", label: "Investment", folders: ["Investment Memos", "Financial Analysis", "Due Diligence", "Correspondence", "Client Reporting"] },
  { value: "Tenant Rep", label: "Tenant Rep", folders: ["Brief", "Search Reports", "Heads of Terms", "Legal", "Correspondence"] },
];

interface SpItem {
  id: string;
  name: string;
  isFolder: boolean;
  childCount: number;
  size: number;
  webUrl: string;
  lastModified: string;
  mimeType?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function PropertyFoldersBrowser({ propertyName }: { propertyName: string }) {
  const [expanded, setExpanded] = useState(false);
  const [currentTeam, setCurrentTeam] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const TEAMS = ["London Leasing", "Investment", "Lease Advisory", "National Leasing", "Tenant Rep", "Development", "Office / Corporate", "Landsec"];

  const { data: teamResults } = useQuery<Record<string, { exists: boolean; folders: SpItem[] }>>({
    queryKey: ["/api/microsoft/property-folders-check", propertyName],
    queryFn: async () => {
      const results: Record<string, { exists: boolean; folders: SpItem[] }> = {};
      for (const team of TEAMS) {
        try {
          const res = await fetch(`/api/microsoft/property-folders/${encodeURIComponent(team)}/${encodeURIComponent(propertyName)}`, {
            credentials: "include",
            headers: getAuthHeaders(),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.exists) results[team] = data;
          }
        } catch {}
      }
      return results;
    },
    enabled: expanded,
    staleTime: 60000,
  });

  const browseQuery = useQuery<{ exists: boolean; folders: SpItem[] }>({
    queryKey: ["/api/microsoft/property-folders", currentTeam, propertyName, currentPath],
    queryFn: async () => {
      let url = `/api/microsoft/property-folders/${encodeURIComponent(currentTeam!)}/${encodeURIComponent(propertyName)}`;
      if (currentPath) {
        url += `?path=${encodeURIComponent(currentPath)}`;
      }
      const res = await fetch(url, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to browse");
      return res.json();
    },
    enabled: !!currentTeam,
  });

  const foundTeams = teamResults ? Object.keys(teamResults) : [];
  const browseItems = browseQuery.data?.folders || [];
  const browseFolders = browseItems.filter(i => i.isFolder).sort((a, b) => a.name.localeCompare(b.name));
  const browseFiles = browseItems.filter(i => !i.isFolder).sort((a, b) => a.name.localeCompare(b.name));

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex items-center gap-1.5 w-full text-left px-2 py-1 rounded hover:bg-muted/50 transition-colors"
      >
        <ChevronRight className="w-3 h-3 text-muted-foreground" />
        <Building className="w-3 h-3 text-teal-500" />
        <span className="text-xs truncate">{propertyName}</span>
      </button>
    );
  }

  return (
    <div className="border rounded overflow-hidden">
      <button
        onClick={() => { setExpanded(false); setCurrentTeam(null); setCurrentPath(""); }}
        className="flex items-center gap-1.5 w-full text-left px-2 py-1.5 bg-teal-50 dark:bg-teal-900/20 hover:bg-teal-100 dark:hover:bg-teal-900/30 transition-colors"
      >
        <ChevronDown className="w-3 h-3 text-teal-600" />
        <Building className="w-3 h-3 text-teal-500" />
        <span className="text-xs font-medium truncate text-teal-700 dark:text-teal-300">{propertyName}</span>
      </button>
      <div className="divide-y">
        {!teamResults && (
          <div className="px-2 py-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            Scanning SharePoint...
          </div>
        )}
        {teamResults && foundTeams.length === 0 && (
          <div className="px-2 py-2 text-[10px] text-muted-foreground">No SharePoint folders found</div>
        )}
        {teamResults && !currentTeam && foundTeams.map(team => (
          <button
            key={team}
            onClick={() => { setCurrentTeam(team); setCurrentPath(""); }}
            className="flex items-center gap-1.5 px-2 py-1.5 w-full text-left hover:bg-muted/50 transition-colors group"
          >
            <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span className="text-xs truncate flex-1">{team}</span>
            <span className="text-[10px] text-muted-foreground">{teamResults[team]?.folders?.length || 0}</span>
            <ChevronRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
          </button>
        ))}
        {currentTeam && (
          <>
            <button
              onClick={() => { if (currentPath) { setCurrentPath(currentPath.split("/").slice(0, -1).join("/")); } else { setCurrentTeam(null); } }}
              className="flex items-center gap-1.5 px-2 py-1 w-full text-left hover:bg-muted/50 transition-colors"
            >
              <ArrowUp className="w-3 h-3 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">..</span>
            </button>
            {browseQuery.isLoading && (
              <div className="px-2 py-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                Loading...
              </div>
            )}
            {browseFolders.map(folder => (
              <button
                key={folder.id}
                onClick={() => setCurrentPath(currentPath ? `${currentPath}/${folder.name}` : folder.name)}
                className="flex items-center gap-1.5 px-2 py-1.5 w-full text-left hover:bg-muted/50 transition-colors group"
              >
                <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span className="text-xs truncate flex-1">{folder.name}</span>
                {folder.childCount > 0 && <span className="text-[10px] text-muted-foreground">{folder.childCount}</span>}
                <ChevronRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
              </button>
            ))}
            {browseFiles.map(file => (
              <a
                key={file.id}
                href={file.webUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-2 py-1.5 w-full hover:bg-muted/50 transition-colors group"
              >
                <FileText className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span className="text-xs truncate flex-1">{file.name}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">{formatFileSize(file.size)}</span>
                <ExternalLink className="w-2.5 h-2.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
              </a>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function CompanyFoldersCard({ companyName, linkedProperties = [] }: { companyName: string; linkedProperties?: CrmProperty[] }) {
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [currentPath, setCurrentPath] = useState<string>("");
  const [showSetup, setShowSetup] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const { toast } = useToast();

  const browseQuery = useQuery<{ exists: boolean; items: SpItem[]; path: string }>({
    queryKey: ["/api/microsoft/company-folders/browse", companyName, currentPath],
    queryFn: async () => {
      const params = new URLSearchParams({ company: companyName });
      if (currentPath) params.set("path", currentPath);
      const res = await fetch(`/api/microsoft/company-folders/browse?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to browse folders");
      return res.json();
    },
  });

  const folderExists = browseQuery.data?.exists;
  const items = browseQuery.data?.items || [];
  const folders = items.filter(i => i.isFolder).sort((a, b) => a.name.localeCompare(b.name));
  const files = items.filter(i => !i.isFolder).sort((a, b) => a.name.localeCompare(b.name));

  const breadcrumbs = currentPath ? currentPath.split("/") : [];

  const createFoldersMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/microsoft/company-folders", {
        companyName,
        template: selectedTemplate,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      setShowSetup(false);
      setSelectedTemplate("");
      queryClient.invalidateQueries({ queryKey: ["/api/microsoft/company-folders/browse", companyName] });
      if (data.errors > 0) {
        toast({ title: "Partial Success", description: `${data.created} folders created, ${data.errors} failed`, variant: "destructive" });
      } else {
        toast({ title: "Folders Created", description: `${data.created} folders created on SharePoint` });
      }
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to create folders", variant: "destructive" });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const folderPath = `BGP share drive/Companies/${companyName}${currentPath ? `/${currentPath}` : ""}`;
      formData.append("folderPath", folderPath);
      const res = await fetch("/api/microsoft/files/upload", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Upload failed");
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/microsoft/company-folders/browse", companyName, currentPath] });
      toast({ title: "File Uploaded", description: data.name });
    },
    onError: (err: any) => {
      toast({ title: "Upload Failed", description: err.message, variant: "destructive" });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
      droppedFiles.forEach(file => uploadMutation.mutate(file));
    }
  };

  const navigateToFolder = (folderName: string) => {
    setCurrentPath(currentPath ? `${currentPath}/${folderName}` : folderName);
  };

  const navigateUp = () => {
    const parts = currentPath.split("/");
    parts.pop();
    setCurrentPath(parts.join("/"));
  };

  const navigateToBreadcrumb = (index: number) => {
    setCurrentPath(breadcrumbs.slice(0, index + 1).join("/"));
  };

  if (browseQuery.isLoading) {
    return (
      <Card data-testid="company-folders-card">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading SharePoint folders...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!folderExists && !showSetup) {
    return (
      <Card data-testid="company-folders-card">
        <CardContent className="p-4 space-y-3">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <FolderTree className="w-4 h-4" />
            SharePoint Folders
          </h3>
          <p className="text-xs text-muted-foreground">No folder structure found for this company on SharePoint.</p>
          <Button size="sm" variant="outline" className="text-xs" onClick={() => setShowSetup(true)} data-testid="button-setup-folders">
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Set Up Folder Structure
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (showSetup || !folderExists) {
    const template = COMPANY_TEMPLATES.find(t => t.value === selectedTemplate);
    return (
      <Card data-testid="company-folders-card">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <FolderTree className="w-4 h-4" />
              Set Up Folders
            </h3>
            {folderExists && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowSetup(false)}>
                <X className="w-3 h-3 mr-1" /> Cancel
              </Button>
            )}
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Folder Template</Label>
            <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
              <SelectTrigger className="h-8 text-sm" data-testid="select-folder-template">
                <SelectValue placeholder="Choose a template..." />
              </SelectTrigger>
              <SelectContent>
                {COMPANY_TEMPLATES.map(t => (
                  <SelectItem key={t.value} value={t.value} data-testid={`template-${t.value}`}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {template && (
            <div className="space-y-2">
              <div className="border rounded-md bg-muted/30 p-3 space-y-0.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <FolderOpen className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-medium">{companyName}</span>
                </div>
                <div className="ml-5 border-l border-border pl-3 space-y-0.5">
                  {template.folders.map(f => (
                    <div key={f} className="flex items-center gap-1.5 py-0.5">
                      <Folder className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      <span className="text-xs">{f}</span>
                    </div>
                  ))}
                </div>
              </div>
              <Button size="sm" className="w-full text-xs" onClick={() => createFoldersMutation.mutate()} disabled={createFoldersMutation.isPending} data-testid="button-create-folders">
                {createFoldersMutation.isPending ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Creating...</> : <><Upload className="w-3.5 h-3.5 mr-1.5" />Create Folders on SharePoint</>}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="company-folders-card">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-xs flex items-center gap-1.5">
            <FolderTree className="w-3.5 h-3.5" />
            SharePoint Folders
          </h3>
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowSetup(true)} title="Add template folders" data-testid="button-add-template">
              <Plus className="w-3 h-3" />
            </Button>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/microsoft/company-folders/browse", companyName, currentPath] })} title="Refresh" data-testid="button-refresh-folders">
              <RefreshCw className="w-3 h-3" />
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-1 text-[10px] flex-wrap">
          <button className="text-primary hover:underline font-medium" onClick={() => setCurrentPath("")} data-testid="breadcrumb-root">
            {companyName}
          </button>
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="w-2.5 h-2.5 text-muted-foreground" />
              <button className={`hover:underline ${i === breadcrumbs.length - 1 ? "font-medium" : "text-primary"}`} onClick={() => navigateToBreadcrumb(i)} data-testid={`breadcrumb-${i}`}>
                {crumb}
              </button>
            </span>
          ))}
        </div>

        <div
          className={`border rounded-md divide-y max-h-[200px] overflow-y-auto relative transition-colors ${isDragging ? "border-primary border-2 bg-primary/5" : ""}`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          data-testid="folder-drop-zone"
        >
          {isDragging && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/10 rounded-md pointer-events-none">
              <div className="flex flex-col items-center gap-1.5 text-primary">
                <Upload className="w-6 h-6" />
                <span className="text-sm font-medium">Drop files here</span>
              </div>
            </div>
          )}

          {currentPath && (
            <button className="flex items-center gap-2 px-3 py-2 w-full text-left hover:bg-muted/50 transition-colors" onClick={navigateUp} data-testid="button-folder-up">
              <ArrowUp className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">..</span>
            </button>
          )}

          {folders.map(folder => (
            <button key={folder.id} className="flex items-center gap-1.5 px-2 py-1.5 w-full text-left hover:bg-muted/50 transition-colors group" onClick={() => navigateToFolder(folder.name)} data-testid={`folder-${folder.id}`}>
              <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span className="text-xs truncate flex-1">{folder.name}</span>
              {folder.childCount > 0 && <span className="text-[10px] text-muted-foreground">{folder.childCount}</span>}
              <ChevronRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
            </button>
          ))}

          {files.map(file => (
            <a key={file.id} href={file.webUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-2 py-1.5 w-full hover:bg-muted/50 transition-colors group" data-testid={`file-${file.id}`}>
              <FileText className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span className="text-xs truncate flex-1">{file.name}</span>
              <span className="text-[10px] text-muted-foreground shrink-0">{formatFileSize(file.size)}</span>
              <ExternalLink className="w-2.5 h-2.5 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
            </a>
          ))}

          {folders.length === 0 && files.length === 0 && !isDragging && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              <Upload className="w-5 h-5 mx-auto mb-1.5 opacity-40" />
              Drop files here or use the upload button
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileSelect} data-testid="input-file-upload" />
          <Button variant="outline" size="sm" className="text-xs flex-1" onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending} data-testid="button-upload-file">
            {uploadMutation.isPending ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Uploading...</> : <><Upload className="w-3.5 h-3.5 mr-1.5" />Upload File</>}
          </Button>
        </div>

        {linkedProperties.length > 0 && (
          <div className="border-t pt-2 mt-1 space-y-1">
            <h4 className="font-semibold text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <Building className="w-3 h-3" />
              Property Folders ({linkedProperties.length})
            </h4>
            <div className="space-y-0.5 max-h-[150px] overflow-y-auto">
              {linkedProperties.map(prop => (
                <PropertyFoldersBrowser key={prop.id} propertyName={prop.name} />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Companies() {
  const [, params] = useRoute("/companies/:id");
  if (params?.id) {
    return <CompanyDetail id={params.id} />;
  }

  return <CompanyList />;
}

const PROGRESS_STAGES = [
  { key: "contacted" as const, label: "Contacted", color: "bg-emerald-500", borderColor: "border-emerald-500", hoverBorder: "hover:border-emerald-400" },
  { key: "detailsSent" as const, label: "Details Sent", color: "bg-blue-500", borderColor: "border-blue-500", hoverBorder: "hover:border-blue-400" },
  { key: "viewing" as const, label: "Viewing", color: "bg-amber-500", borderColor: "border-amber-500", hoverBorder: "hover:border-amber-400" },
  { key: "shortlisted" as const, label: "Shortlisted", color: "bg-purple-500", borderColor: "border-purple-500", hoverBorder: "hover:border-purple-400" },
  { key: "underOffer" as const, label: "Under Offer", color: "bg-red-500", borderColor: "border-red-500", hoverBorder: "hover:border-red-400" },
];

function CompanyProgressTickCell({
  company,
  onToggle,
  testIdPrefix,
}: {
  company: { contacted: boolean; detailsSent: boolean; viewing: boolean; shortlisted: boolean; underOffer: boolean };
  onToggle: (field: string, value: boolean) => void;
  testIdPrefix: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const activeCount = PROGRESS_STAGES.filter((s) => company[s.key]).length;
  const activeStages = PROGRESS_STAGES.filter((s) => company[s.key]);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs transition-colors ${
          activeCount > 0
            ? "border-gray-300 bg-white hover:bg-gray-50"
            : "border-dashed border-gray-300 text-muted-foreground hover:border-gray-400"
        }`}
        data-testid={`${testIdPrefix}-btn`}
      >
        {activeCount > 0 ? (
          <>
            {activeStages.map((s) => (
              <span key={s.key} className={`w-2 h-2 rounded-full ${s.color}`} title={s.label} />
            ))}
            <span className="ml-0.5 text-muted-foreground">{activeCount}/5</span>
          </>
        ) : (
          <span className="flex items-center gap-1">
            <Circle className="w-3 h-3" />
            0/5
          </span>
        )}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 left-1/2 -translate-x-1/2 bg-popover border rounded-lg shadow-lg p-1.5 min-w-[180px]">
          {PROGRESS_STAGES.map((stage) => {
            const active = company[stage.key];
            return (
              <button
                key={stage.key}
                type="button"
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-accent text-left text-sm transition-colors"
                onClick={() => onToggle(stage.key, !active)}
                data-testid={`${testIdPrefix}-${stage.key}`}
              >
                <div
                  className={`w-5 h-5 rounded border-2 inline-flex items-center justify-center transition-colors ${
                    active ? `${stage.color} ${stage.borderColor} text-white` : `border-gray-300 ${stage.hoverBorder}`
                  }`}
                >
                  {active && <Check className="w-3 h-3" />}
                </div>
                <span className={active ? "font-medium" : "text-muted-foreground"}>{stage.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CompanyList() {
  const [search, setSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const { toast } = useToast();

  const [trlImporting, setTrlImporting] = useState<string | null>(null);

  const trlDirectoryImportMutation = useMutation({
    mutationFn: async (directory: string) => {
      setTrlImporting(directory);
      const res = await apiRequest("POST", "/api/crm/import-trl-directories", { directory });
      return res.json();
    },
    onSuccess: (data: any) => {
      setTrlImporting(null);
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
      toast({
        title: "TRL Import Complete",
        description: `${data.companies?.created || 0} companies created, ${data.contacts?.created || 0} contacts created${data.errors?.length ? ` (${data.errors.length} errors)` : ""}`,
      });
    },
    onError: (err: Error) => {
      setTrlImporting(null);
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    },
  });

  const [enrichOpen, setEnrichOpen] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState({ processed: 0, enriched: 0, total: 0, remaining: 0 });
  const [enrichType, setEnrichType] = useState<"companies" | "contacts">("companies");
  const enrichAbortRef = useRef(false);

  const startEnrichment = async (type: "companies" | "contacts") => {
    setEnrichType(type);
    setEnriching(true);
    setEnrichOpen(true);
    enrichAbortRef.current = false;
    setEnrichProgress({ processed: 0, enriched: 0, total: 0, remaining: 0 });

    let totalProcessed = 0;
    let totalEnriched = 0;
    let initialTotal = 0;
    const batchSize = 10;
    const endpoint = type === "companies" ? "/api/crm/companies/ai-enrich" : "/api/crm/contacts/ai-enrich";

    try {
      while (true) {
        if (enrichAbortRef.current) break;
        const res = await apiRequest("POST", endpoint, { batchSize });
        const data = await res.json();
        if (initialTotal === 0) initialTotal = (data.total || 0) + (data.processed || 0);
        totalProcessed += data.processed || 0;
        totalEnriched += data.enriched || 0;
        setEnrichProgress({
          processed: totalProcessed,
          enriched: totalEnriched,
          total: initialTotal,
          remaining: data.remaining || 0,
        });
        if (data.remaining <= 0 || data.processed === 0) break;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
      toast({
        title: "AI Enrichment Complete",
        description: `Updated ${totalEnriched} of ${totalProcessed} ${type} processed`,
      });
    } catch (err: any) {
      toast({ title: "Enrichment error", description: err.message, variant: "destructive" });
    } finally {
      setEnriching(false);
    }
  };

  const inlineUpdateMutation = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: string | number | string[] | null }) => {
      await apiRequest("PUT", `/api/crm/companies/${id}`, { [field]: value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const { data: companies, isLoading, error } = useQuery<CrmCompany[]>({
    queryKey: ["/api/crm/companies"],
  });

  const { data: allContacts } = useQuery<CrmContact[]>({
    queryKey: ["/api/crm/contacts"],
  });

  const { data: allUsers } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/users"],
  });

  const userNames = useMemo(() => {
    if (!allUsers) return [];
    return allUsers.map(u => u.name).sort();
  }, [allUsers]);

  const userOptions = useMemo(() => {
    if (!allUsers) return [];
    return allUsers.map(u => ({ label: u.name, value: u.name })).sort((a, b) => a.label.localeCompare(b.label));
  }, [allUsers]);

  const userColorMap = useMemo(() => buildUserColorMap(allUsers), [allUsers]);

  const { data: allProperties } = useQuery<CrmProperty[]>({
    queryKey: ["/api/crm/properties"],
  });

  const { data: allDeals } = useQuery<CrmDeal[]>({
    queryKey: ["/api/crm/deals"],
  });

  const { data: companyPropertyLinks } = useQuery<{ companyId: string; propertyId: string }[]>({
    queryKey: ["/api/crm/company-property-links"],
  });

  const { data: companyDealLinks } = useQuery<{ companyId: string; dealId: string }[]>({
    queryKey: ["/api/crm/company-deal-links"],
  });

  const propertyIdsByCompany = useMemo(() => {
    if (!companyPropertyLinks) return {};
    const map: Record<string, string[]> = {};
    companyPropertyLinks.forEach(l => {
      if (!map[l.companyId]) map[l.companyId] = [];
      map[l.companyId].push(l.propertyId);
    });
    return map;
  }, [companyPropertyLinks]);

  const dealIdsByCompany = useMemo(() => {
    if (!companyDealLinks) return {};
    const map: Record<string, string[]> = {};
    companyDealLinks.forEach(l => {
      if (!map[l.companyId]) map[l.companyId] = [];
      map[l.companyId].push(l.dealId);
    });
    return map;
  }, [companyDealLinks]);

  const contactCountsByCompany = useMemo(() => {
    if (!allContacts) return {};
    const counts: Record<string, number> = {};
    allContacts.forEach((c) => {
      if (c.companyId) {
        counts[c.companyId] = (counts[c.companyId] || 0) + 1;
      }
    });
    return counts;
  }, [allContacts]);

  const companyTypes = useMemo(() => {
    if (!companies) return [...CRM_OPTIONS.companyType];
    const types = new Set<string>(CRM_OPTIONS.companyType);
    companies.forEach((c) => { if (c.companyType) types.add(c.companyType); });
    return Array.from(types).sort();
  }, [companies]);

  const toggleColumnFilter = (column: string, value: string) => {
    setColumnFilters((prev) => {
      const current = prev[column] || [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      if (next.length === 0) {
        const { [column]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [column]: next };
    });
  };

  const filteredCompanies = useMemo(() => {
    if (!companies) return [];
    return companies.filter((c) => {
      if (columnFilters.type?.length && !columnFilters.type.includes(c.companyType || "")) return false;
      if (search) {
        const s = search.toLowerCase();
        return (
          c.name.toLowerCase().includes(s) ||
          (c.domain || "").toLowerCase().includes(s) ||
          (c.companyType || "").toLowerCase().includes(s) ||
          (c.description || "").toLowerCase().includes(s)
        );
      }
      return true;
    });
  }, [companies, columnFilters, search]);

  if (error) {
    return (
      <div className="p-4 sm:p-6">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Companies</h1>
            <p className="text-sm text-muted-foreground">CRM Companies</p>
          </div>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <h3 className="font-medium mb-1">Could not load Companies</h3>
            <p className="text-sm text-muted-foreground">Please try again later.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const clearAllFilters = () => {
    setSearch("");
    setColumnFilters({});
  };

  const hasActiveFilters = search || Object.keys(columnFilters).length > 0;

  const typeCounts = useMemo(() => {
    if (!companies) return {};
    const counts: Record<string, number> = {};
    companies.forEach((c) => {
      const t = c.companyType || "Uncategorised";
      counts[t] = (counts[t] || 0) + 1;
    });
    return counts;
  }, [companies]);

  const TYPE_STAT_CARDS: { label: string; type: string | null; icon: any; color: string; activeColor: string }[] = [
    { label: "All Companies", type: null, icon: Building2, color: "bg-blue-600", activeColor: "bg-blue-800 ring-2 ring-blue-400" },
    { label: "Landlords", type: "Landlord", icon: Crown, color: "bg-emerald-600", activeColor: "bg-emerald-800 ring-2 ring-emerald-400" },
    { label: "Agents", type: "Agent", icon: Briefcase, color: "bg-indigo-600", activeColor: "bg-indigo-800 ring-2 ring-indigo-400" },
    { label: "Clients", type: "Client", icon: UserCheck, color: "bg-sky-600", activeColor: "bg-sky-800 ring-2 ring-sky-400" },
    { label: "Tenant - Retail", type: "Tenant - Retail", icon: Building, color: "bg-teal-600", activeColor: "bg-teal-800 ring-2 ring-teal-400" },
    { label: "Tenant - Restaurant", type: "Tenant - Restaurant", icon: Building, color: "bg-rose-600", activeColor: "bg-rose-800 ring-2 ring-rose-400" },
    { label: "Tenant - Leisure", type: "Tenant - Leisure", icon: Building, color: "bg-purple-600", activeColor: "bg-purple-800 ring-2 ring-purple-400" },
    { label: "Investors", type: "Investor", icon: Handshake, color: "bg-amber-600", activeColor: "bg-amber-800 ring-2 ring-amber-400" },
  ];

  const activeTypeFilter = columnFilters.type || [];

  const handleStatClick = (type: string | null) => {
    if (type === null) {
      setColumnFilters({});
      setSearch("");
    } else {
      const current = columnFilters.type || [];
      if (current.length === 1 && current[0] === type) {
        const { type: _, ...rest } = columnFilters;
        setColumnFilters(rest);
      } else {
        setColumnFilters({ ...columnFilters, type: [type] });
      }
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6" data-testid="companies-page">
      <CompanyFormDialog open={createOpen} onOpenChange={setCreateOpen} />

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Companies</h1>
          <p className="text-sm text-muted-foreground">
            {companies?.length || 0} companies in CRM
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={enriching} data-testid="button-ai-enrich">
                {enriching ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                {enriching ? "Enriching..." : "AI Enrich"}
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => startEnrichment("companies")} data-testid="button-ai-enrich-companies">
                <Building className="w-4 h-4 mr-2" />
                Enrich Companies (websites, descriptions, locations)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => startEnrichment("contacts")} data-testid="button-ai-enrich-contacts">
                <Users className="w-4 h-4 mr-2" />
                Enrich Contacts (roles/titles)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="button-create-company">
            <Plus className="w-4 h-4 mr-2" />
            New Company
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {TYPE_STAT_CARDS.map((card) => {
          const isActive = card.type === null
            ? activeTypeFilter.length === 0
            : activeTypeFilter.length === 1 && activeTypeFilter[0] === card.type;
          const count = card.type === null ? (companies?.length || 0) : (typeCounts[card.type] || 0);
          return (
            <div
              key={card.label}
              className="cursor-pointer"
              onClick={() => handleStatClick(card.type)}
              data-testid={`stat-${card.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <Card className={`overflow-hidden transition-all ${isActive ? "ring-2 ring-primary" : "hover:shadow-md"}`}>
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-lg ${isActive ? card.activeColor : card.color} flex items-center justify-center`}>
                      <card.icon className="w-4 h-4 text-white" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-lg font-bold leading-tight">{count}</p>
                      <p className="text-[10px] text-muted-foreground truncate leading-tight">{card.label}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          );
        })}
      </div>

      <Dialog open={enrichOpen} onOpenChange={(open) => { if (!open && enriching) enrichAbortRef.current = true; setEnrichOpen(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle data-testid="text-enrich-title">
              AI Enrichment — {enrichType === "companies" ? "Companies" : "Contacts"}
            </DialogTitle>
            <DialogDescription>
              {enriching
                ? `Processing ${enrichType} in batches of 10 using AI...`
                : enrichProgress.processed > 0
                  ? "Enrichment complete."
                  : "Ready to start enrichment."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progress</span>
                <span data-testid="text-enrich-progress">
                  {enrichProgress.processed} / {enrichProgress.total} processed
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
                <div
                  className="bg-primary h-full rounded-full transition-all duration-300"
                  style={{ width: enrichProgress.total > 0 ? `${(enrichProgress.processed / enrichProgress.total) * 100}%` : "0%" }}
                  data-testid="progress-bar-enrich"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold" data-testid="text-enrich-updated">{enrichProgress.enriched}</p>
                <p className="text-xs text-muted-foreground">Updated</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{enrichProgress.processed}</p>
                <p className="text-xs text-muted-foreground">Processed</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{enrichProgress.remaining}</p>
                <p className="text-xs text-muted-foreground">Remaining</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            {enriching ? (
              <Button variant="outline" onClick={() => { enrichAbortRef.current = true; }} data-testid="button-stop-enrich">
                Stop
              </Button>
            ) : (
              <Button onClick={() => setEnrichOpen(false)} data-testid="button-close-enrich">
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <div className="space-y-3">
          <div className="flex gap-3 flex-wrap">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-16 flex-1 min-w-[130px]" />
            ))}
          </div>
          <Skeleton className="h-10" />
          <Skeleton className="h-[400px]" />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search companies..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-search-companies"
              />
            </div>
            {columnFilters.type?.map((v) => (
              <Badge
                key={v}
                variant="secondary"
                className="cursor-pointer gap-1 text-xs"
                onClick={() => toggleColumnFilter("type", v)}
                data-testid={`badge-active-type-filter-${v}`}
              >
                Type: {v}
                <X className="w-3 h-3" />
              </Badge>
            ))}
            {hasActiveFilters && (
              <Button variant="outline" size="sm" onClick={clearAllFilters} data-testid="button-clear-filters">
                <X className="w-3.5 h-3.5 mr-1" />
                Clear
              </Button>
            )}
            <div className="text-xs text-muted-foreground">
              {filteredCompanies.length} of {companies?.length || 0} companies
            </div>
          </div>

          {filteredCompanies.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Building className="w-10 h-10 mx-auto text-muted-foreground mb-3 opacity-30" />
                <h3 className="font-medium mb-1">No companies found</h3>
                <p className="text-sm text-muted-foreground">
                  {hasActiveFilters ? "Try adjusting your search or filters" : "Add your first company to get started"}
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <ScrollableTable minWidth={1800}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[180px] font-medium">Company</TableHead>
                      <TableHead className="min-w-[100px]">
                        <ColumnFilterPopover
                          label="Type"
                          options={companyTypes}
                          activeFilters={columnFilters.type || []}
                          onToggleFilter={(v) => toggleColumnFilter("type", v)}
                        />
                      </TableHead>
                      <TableHead className="min-w-[160px]">Properties</TableHead>
                      <TableHead className="min-w-[160px]">WIP</TableHead>
                      <TableHead className="min-w-[200px]">Head Office</TableHead>
                      <TableHead className="min-w-[120px]">Website</TableHead>
                      <TableHead className="min-w-[80px]">Contacts</TableHead>
                      <TableHead className="min-w-[130px]">BGP Contact</TableHead>
                      <TableHead className="min-w-[150px]">Description</TableHead>
                      <TableHead className="min-w-[100px] text-center">Progress</TableHead>
                      <TableHead className="min-w-[80px] text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCompanies.map((company) => (
                      <TableRow key={company.id} className="text-xs" data-testid={`row-company-${company.id}`}>
                        <TableCell className="px-1.5 py-1 font-medium">
                          <Link href={`/companies/${company.id}`}>
                            <span className="hover:underline cursor-pointer" data-testid={`text-company-name-${company.id}`}>{company.name}</span>
                          </Link>
                        </TableCell>
                        <TableCell className="px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
                          <InlineLabelSelect
                            value={company.companyType}
                            options={CRM_OPTIONS.companyType}
                            colorMap={CRM_OPTIONS.companyTypeColors}
                            onSave={(v) => inlineUpdateMutation.mutate({ id: company.id, field: "companyType", value: v })}
                            placeholder="Set type"
                          />
                        </TableCell>
                        <TableCell className="px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
                          <EntityPicker
                            companyId={company.id}
                            linkedIds={propertyIdsByCompany[company.id] || []}
                            allItems={(allProperties || []).map(p => ({ id: p.id, name: p.name }))}
                            entityType="properties"
                            icon={<Building2 className="w-2.5 h-2.5" />}
                            invalidateKey="/api/crm/company-property-links"
                            searchPlaceholder="Search properties..."
                          />
                        </TableCell>
                        <TableCell className="px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
                          <EntityPicker
                            companyId={company.id}
                            linkedIds={dealIdsByCompany[company.id] || []}
                            allItems={(allDeals || []).map(d => ({ id: d.id, name: d.name }))}
                            entityType="deals"
                            icon={<Handshake className="w-2.5 h-2.5" />}
                            invalidateKey="/api/crm/company-deal-links"
                            searchPlaceholder="Search deals..."
                          />
                        </TableCell>
                        <TableCell className="px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
                          <InlineAddress
                            value={company.headOfficeAddress as any}
                            onSave={(addr) => inlineUpdateMutation.mutate({ id: company.id, field: "headOfficeAddress", value: addr })}
                            placeholder="Set address"
                          />
                        </TableCell>
                        <TableCell className="px-1.5 py-1">
                          {company.domainUrl ? (
                            <a
                              href={company.domainUrl.startsWith("http") ? company.domainUrl : `https://${company.domainUrl}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                              data-testid={`link-website-${company.id}`}
                            >
                              <Globe className="w-3 h-3 shrink-0" />
                              <span className="truncate max-w-[140px]">{company.domainUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
                            </a>
                          ) : (
                            <span className="text-muted-foreground italic">—</span>
                          )}
                        </TableCell>
                        <TableCell className="px-1.5 py-1 text-center">
                          {contactCountsByCompany[company.id] ? (
                            <Link href={`/companies/${company.id}`}>
                              <Badge variant="secondary" className="cursor-pointer text-xs" data-testid={`badge-contacts-${company.id}`}>
                                <Users className="w-3 h-3 mr-1" />
                                {contactCountsByCompany[company.id]}
                              </Badge>
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        <TableCell className="px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
                          <InlineMultiSelect
                            value={getCompanyBgpContacts(company)}
                            options={userOptions}
                            colorMap={userColorMap}
                            placeholder="Set contacts"
                            onSave={(v) => {
                              apiRequest("PUT", `/api/crm/companies/${company.id}`, {
                                bgpContactUserIds: v.length > 0 ? v : null,
                                bgpContactCrm: null,
                              }).then(() => queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] }));
                            }}
                            testId={`inline-bgp-contact-${company.id}`}
                          />
                        </TableCell>
                        <TableCell className="px-1.5 py-1 max-w-[200px]">
                          <InlineText
                            value={company.description}
                            onSave={(v) => inlineUpdateMutation.mutate({ id: company.id, field: "description", value: v })}
                            placeholder="Add description"
                            data-testid={`inline-description-${company.id}`}
                            maxLines={2}
                          />
                        </TableCell>
                        <TableCell className="px-1.5 py-1 text-center">
                          <CompanyProgressTickCell
                            company={company}
                            onToggle={(field, value) => inlineUpdateMutation.mutate({ id: company.id, field, value: value as any })}
                            testIdPrefix={`tick-company-${company.id}`}
                          />
                        </TableCell>
                        <TableCell className="px-1 py-1 text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              data-testid={`button-edit-company-${company.id}`}
                            >
                              <Link href={`/companies/${company.id}`}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Link>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={async () => {
                                if (!confirm("Delete this company?")) return;
                                try {
                                  await apiRequest("DELETE", `/api/crm/companies/${company.id}`);
                                  queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
                                  toast({ title: "Company deleted" });
                                } catch {
                                  toast({ title: "Failed to delete", variant: "destructive" });
                                }
                              }}
                              data-testid={`button-delete-company-${company.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollableTable>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
