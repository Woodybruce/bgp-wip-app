import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, Handshake, Users, PoundSterling, TrendingUp, TrendingDown } from "lucide-react";
import { formatCurrencyShort } from "./helpers";

interface KpiTrends {
  months: string[];
  dealsPerMonth: number[];
  feesPerMonth: number[];
  propertiesPerMonth: number[];
  contactsPerMonth: number[];
  totalDeals: number;
  totalFees: number;
  totalProperties: number;
  totalContacts: number;
  dealsChange: number;
  feesChange: number;
  propertiesChange: number;
  contactsChange: number;
}

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  if (!data.length) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 60, h = 20;
  const points = data.map((v, i) =>
    `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`
  ).join(" ");
  return (
    <svg width={w} height={h} className="inline-block ml-2">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
      {data.map((v, i) => (
        <circle
          key={i}
          cx={(i / (data.length - 1)) * w}
          cy={h - ((v - min) / range) * h}
          r="1.5"
          fill={color}
        />
      ))}
    </svg>
  );
}

function TrendBadge({ change }: { change: number }) {
  if (change === 0) {
    return <span className="text-[10px] text-muted-foreground ml-1">0%</span>;
  }
  const isUp = change > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ml-1 ${isUp ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
      {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {Math.abs(change)}%
    </span>
  );
}

export function KpiOverviewWidget() {
  const { data: trends, isLoading } = useQuery<KpiTrends>({
    queryKey: ["/api/dashboard/kpi-trends"],
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!trends) return null;

  const kpis = [
    {
      label: "Deals",
      value: trends.totalDeals.toLocaleString(),
      change: trends.dealsChange,
      data: trends.dealsPerMonth,
      color: "#3b82f6",
      bgClass: "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800",
      textClass: "text-blue-600 dark:text-blue-400",
      valueClass: "text-blue-700 dark:text-blue-300",
      icon: Handshake,
    },
    {
      label: "Total Fees",
      value: formatCurrencyShort(trends.totalFees),
      change: trends.feesChange,
      data: trends.feesPerMonth,
      color: "#10b981",
      bgClass: "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800",
      textClass: "text-emerald-600 dark:text-emerald-400",
      valueClass: "text-emerald-700 dark:text-emerald-300",
      icon: PoundSterling,
    },
    {
      label: "Properties",
      value: trends.totalProperties.toLocaleString(),
      change: trends.propertiesChange,
      data: trends.propertiesPerMonth,
      color: "#14b8a6",
      bgClass: "bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-800",
      textClass: "text-teal-600 dark:text-teal-400",
      valueClass: "text-teal-700 dark:text-teal-300",
      icon: Building2,
    },
    {
      label: "Contacts",
      value: trends.totalContacts.toLocaleString(),
      change: trends.contactsChange,
      data: trends.contactsPerMonth,
      color: "#8b5cf6",
      bgClass: "bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800",
      textClass: "text-purple-600 dark:text-purple-400",
      valueClass: "text-purple-700 dark:text-purple-300",
      icon: Users,
    },
  ];

  return (
    <Card key="kpi-overview" className="h-full" data-testid="widget-kpi-overview">
      <CardContent className="p-3 h-full">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 h-full">
          {kpis.map((kpi) => {
            const Icon = kpi.icon;
            return (
              <div
                key={kpi.label}
                className={`flex flex-col justify-center p-3 rounded-lg border ${kpi.bgClass}`}
                data-testid={`kpi-${kpi.label.toLowerCase().replace(/\s/g, "-")}`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className={`w-3.5 h-3.5 ${kpi.textClass}`} />
                  <p className={`text-[10px] font-medium uppercase tracking-wider ${kpi.textClass}`}>{kpi.label}</p>
                </div>
                <div className="flex items-center gap-1">
                  <p className={`text-xl font-bold ${kpi.valueClass}`}>{kpi.value}</p>
                  <TrendBadge change={kpi.change} />
                </div>
                <div className="flex items-center mt-1">
                  <span className="text-[9px] text-muted-foreground">6mo trend</span>
                  <MiniSparkline data={kpi.data} color={kpi.color} />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
