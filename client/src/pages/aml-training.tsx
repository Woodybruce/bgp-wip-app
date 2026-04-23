import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useRoute, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChatBGPMarkdown } from "@/components/chatbgp-markdown";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  BookOpenCheck, Clock, CheckCircle2, XCircle, Loader2, ArrowLeft,
  GraduationCap, Play, Award, AlertCircle, Handshake, ChevronRight, Shield,
} from "lucide-react";

interface MyLiveDeal {
  id: string;
  name: string;
  status: string | null;
  deal_type: string | null;
  fee: number | null;
  property_name: string | null;
  landlord_name: string | null; landlord_kyc: string | null;
  tenant_name: string | null; tenant_kyc: string | null;
  vendor_name: string | null; vendor_kyc: string | null;
  purchaser_name: string | null; purchaser_kyc: string | null;
}

function MyLiveDealsPanel() {
  const { data: deals = [], isLoading } = useQuery<MyLiveDeal[]>({
    queryKey: ["/api/kyc/my-deals"],
<<<<<<< HEAD
    queryFn: async () => {
      const res = await fetch("/api/kyc/my-deals", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
=======
>>>>>>> claude/terminal-coding-interface-JOGQK
  });

  if (isLoading) return null;
  if (deals.length === 0) return null;

  const renderCounterparty = (role: string, name: string | null, kyc: string | null) => {
    if (!name) return null;
    const approved = kyc === "approved";
    return (
      <div key={`${role}-${name}`} className="flex items-center gap-1.5 text-[11px]">
        {approved ? <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" /> : <AlertCircle className="w-3 h-3 text-amber-500 shrink-0" />}
        <span className="uppercase text-[9px] text-muted-foreground font-semibold shrink-0">{role}</span>
        <span className="truncate">{name}</span>
      </div>
    );
  };

  const allCleanCount = deals.filter(d => {
    const cps = [
      { n: d.landlord_name, k: d.landlord_kyc },
      { n: d.tenant_name, k: d.tenant_kyc },
      { n: d.vendor_name, k: d.vendor_kyc },
      { n: d.purchaser_name, k: d.purchaser_kyc },
    ].filter(x => x.n);
    return cps.length >= 2 && cps.every(x => x.k === "approved");
  }).length;

  return (
    <Card className="mb-6 border-primary/30 bg-primary/[0.02]" data-testid="my-live-deals-panel">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Handshake className="w-4 h-4 text-primary" />
            Your live deals — AML status
          </CardTitle>
          <div className="text-xs text-muted-foreground">
            <span className="font-semibold text-emerald-600">{allCleanCount}</span> / {deals.length} ready to invoice
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Deals where you're the agent. Training you've just completed applies to counterparties you work with — these are the ones needing attention.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {deals.slice(0, 6).map(d => (
            <a
              key={d.id}
              href={`/deals/${d.id}`}
              className="block bg-white border border-border/60 rounded-lg p-3 hover:shadow-sm hover:border-primary/40 transition-all"
              data-testid={`my-deal-${d.id}`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="font-semibold text-sm truncate">{d.name}</span>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              </div>
              {d.property_name && (
                <div className="text-[11px] text-muted-foreground truncate mb-1.5">{d.property_name}</div>
              )}
              <div className="space-y-0.5">
                {renderCounterparty("landlord", d.landlord_name, d.landlord_kyc)}
                {renderCounterparty("tenant", d.tenant_name, d.tenant_kyc)}
                {renderCounterparty("vendor", d.vendor_name, d.vendor_kyc)}
                {renderCounterparty("purchaser", d.purchaser_name, d.purchaser_kyc)}
              </div>
            </a>
          ))}
        </div>
        {deals.length > 6 && (
          <a href="/kyc-clouseau?tab=board" className="block text-xs text-primary hover:underline mt-3 text-center">
            See all {deals.length} on the Compliance Board →
          </a>
        )}
      </CardContent>
    </Card>
  );
}

interface TrainingModule {
  id: string;
  title: string;
  description: string;
  content_markdown: string;
  quiz: Array<{ question: string; options: string[]; correct: number; explanation?: string }>;
  pass_score: number;
  estimated_minutes: number | null;
  active: boolean;
}

interface TrainingAttempt {
  id: string;
  module_id: string;
  module_title: string;
  user_id: string;
  user_name: string | null;
  score: number;
  passed: boolean;
  completed_at: string | null;
  answers: Record<number, number>;
}

function StatusBadge({ attempts }: { attempts: TrainingAttempt[] }) {
  if (attempts.length === 0) return <Badge variant="secondary">Not started</Badge>;
  const passed = attempts.find(a => a.passed);
  if (passed) return <Badge className="bg-emerald-600"><CheckCircle2 className="w-3 h-3 mr-1" />Passed · {passed.score}%</Badge>;
  const latest = attempts[0];
  return <Badge className="bg-amber-600"><AlertCircle className="w-3 h-3 mr-1" />Attempted · {latest.score}%</Badge>;
}

export default function AmlTraining() {
  const [matchModule, moduleParams] = useRoute("/aml-training/:id");
  const [, navigate] = useLocation();

  if (matchModule && moduleParams?.id) {
    return <TakeModule moduleId={moduleParams.id} onBack={() => navigate("/aml-training")} />;
  }
  return <ModuleList />;
}

function ModuleList() {
  const { data: modules = [], isLoading } = useQuery<TrainingModule[]>({
    queryKey: ["/api/aml/training-modules"],
  });

  const { data: myAttempts = [] } = useQuery<TrainingAttempt[]>({
    queryKey: ["/api/aml/training-attempts"],
  });

  const attemptsByModule = useMemo(() => {
    const map = new Map<string, TrainingAttempt[]>();
    for (const a of myAttempts) {
      const arr = map.get(a.module_id) || [];
      arr.push(a);
      map.set(a.module_id, arr);
    }
    return map;
  }, [myAttempts]);

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  const passedCount = modules.filter(m => (attemptsByModule.get(m.id) || []).some(a => a.passed)).length;

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <GraduationCap className="w-6 h-6 text-primary" />
            AML Training
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Interactive modules · complete the quiz to auto-log the training to your MLR 2017 training record
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold">{passedCount} / {modules.length}</div>
          <div className="text-xs text-muted-foreground uppercase tracking-wide">passed</div>
        </div>
      </div>

      <MyLiveDealsPanel />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {modules.map(m => {
          const attempts = attemptsByModule.get(m.id) || [];
          const passed = attempts.find(a => a.passed);
          return (
            <Card key={m.id} className={passed ? "border-emerald-300 bg-emerald-50/30" : ""} data-testid={`module-card-${m.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <BookOpenCheck className="w-4 h-4 text-primary shrink-0" />
                    {m.title}
                  </CardTitle>
                  <StatusBadge attempts={attempts} />
                </div>
                <p className="text-xs text-muted-foreground mt-1">{m.description}</p>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
                  {m.estimated_minutes && (
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{m.estimated_minutes} min</span>
                  )}
                  <span>{m.quiz.length} questions</span>
                  <span>Pass at {m.pass_score}%</span>
                </div>
                <Link href={`/aml-training/${m.id}`} data-testid={`module-start-${m.id}`}>
                  <Button size="sm" className="w-full" variant={passed ? "outline" : "default"}>
                    <Play className="w-3.5 h-3.5 mr-1.5" />
                    {passed ? "Re-take" : attempts.length > 0 ? "Continue" : "Start module"}
                  </Button>
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function TakeModule({ moduleId, onBack }: { moduleId: string; onBack: () => void }) {
  const { toast } = useToast();
  const [stage, setStage] = useState<"reading" | "quiz" | "result">("reading");
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState<any>(null);

  const { data: mod, isLoading } = useQuery<TrainingModule>({
    queryKey: [`/api/aml/training-modules/${moduleId}`],
  });

  const submit = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/aml/training-modules/${moduleId}/attempt`, { answers });
      return res.json();
    },
    onSuccess: (data) => {
      setResult(data);
      setStage("result");
      queryClient.invalidateQueries({ queryKey: ["/api/aml/training-attempts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/aml/training"] });
      if (data.passed) {
        toast({ title: `Passed with ${data.score}%`, description: "Logged to your MLR 2017 training record." });
      } else {
        toast({ title: `Score: ${data.score}%`, description: `Need ${mod?.pass_score}% to pass. Review and try again.`, variant: "destructive" });
      }
    },
  });

  if (isLoading || !mod) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  const allAnswered = mod.quiz.every((_, i) => answers[i] !== undefined);

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto">
      <Button variant="ghost" size="sm" onClick={onBack} className="mb-3" data-testid="button-back-to-modules">
        <ArrowLeft className="w-3.5 h-3.5 mr-1" />
        All modules
      </Button>

      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">{mod.title}</h1>
        <p className="text-sm text-muted-foreground mt-1">{mod.description}</p>
      </div>

      {stage === "reading" && (
        <Card>
          <CardContent className="p-6">
            <ChatBGPMarkdown content={mod.content_markdown} />
            <div className="mt-6 pt-4 border-t border-border flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {mod.quiz.length} questions · pass at {mod.pass_score}%
              </span>
              <Button onClick={() => setStage("quiz")} data-testid="button-start-quiz">
                Start quiz
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {stage === "quiz" && (
        <div className="space-y-4">
          {mod.quiz.map((q, i) => (
            <Card key={i} data-testid={`quiz-question-${i}`}>
              <CardContent className="p-5">
                <h3 className="font-semibold mb-3">{i + 1}. {q.question}</h3>
                <div className="space-y-2">
                  {q.options.map((opt, j) => (
                    <label
                      key={j}
                      className={`flex items-center gap-2 p-3 rounded-md border cursor-pointer hover:bg-muted/40 ${
                        answers[i] === j ? "border-primary bg-primary/5" : "border-border"
                      }`}
                      data-testid={`quiz-option-${i}-${j}`}
                    >
                      <input
                        type="radio"
                        name={`q-${i}`}
                        checked={answers[i] === j}
                        onChange={() => setAnswers(prev => ({ ...prev, [i]: j }))}
                      />
                      <span className="text-sm">{opt}</span>
                    </label>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
          <div className="flex items-center justify-between pt-2">
            <Button variant="ghost" onClick={() => setStage("reading")}>Back to content</Button>
            <Button
              onClick={() => submit.mutate()}
              disabled={!allAnswered || submit.isPending}
              data-testid="button-submit-quiz"
            >
              {submit.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              Submit answers
            </Button>
          </div>
        </div>
      )}

      {stage === "result" && result && (
        <Card>
          <CardContent className="p-6 text-center">
            <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center ${result.passed ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600"}`}>
              {result.passed ? <Award className="w-10 h-10" /> : <XCircle className="w-10 h-10" />}
            </div>
            <h2 className="text-2xl font-bold mt-4">{result.score}%</h2>
            <p className="text-sm text-muted-foreground">
              {result.correct} out of {result.total} correct · needed {mod.pass_score}% to pass
            </p>
            <div className={`mt-3 inline-block px-3 py-1 rounded-full text-sm font-semibold ${result.passed ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
              {result.passed ? "Passed — logged to training record" : "Did not pass"}
            </div>

            <div className="mt-6 text-left space-y-3">
              <h3 className="font-semibold">Review</h3>
              {mod.quiz.map((q, i) => {
                const d = result.detail.find((x: any) => x.index === i);
                if (!d) return null;
                return (
                  <div key={i} className={`p-3 rounded-md border ${d.right ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50"}`}>
                    <div className="flex items-start gap-2">
                      {d.right ? <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" /> : <XCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />}
                      <div className="flex-1">
                        <p className="text-sm font-medium">{i + 1}. {q.question}</p>
                        <p className="text-xs text-muted-foreground mt-1">Your answer: <span className={d.right ? "text-emerald-700" : "text-red-700"}>{q.options[d.picked] || "(none)"}</span></p>
                        {!d.right && (
                          <p className="text-xs text-emerald-700 mt-0.5">Correct: {q.options[q.correct]}</p>
                        )}
                        {q.explanation && (
                          <p className="text-xs italic text-muted-foreground mt-1">{q.explanation}</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 flex gap-2 justify-center">
              <Button variant="outline" onClick={onBack}>All modules</Button>
              {!result.passed && (
                <Button onClick={() => { setAnswers({}); setResult(null); setStage("reading"); }}>
                  Re-read and try again
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
