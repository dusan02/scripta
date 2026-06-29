"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

type ChartData = {
  year: number;
  netProfitLoss: number;
  operatingCashFlow: number;
};

export default function FinancialChart({ data }: { data: ChartData[] }) {
  // Ak máme málo dát, napr. 1 rok, graf to síce vykreslí ako bod, ale lepšie je sortovať vzostupne
  const sortedData = [...data].sort((a, b) => a.year - b.year);

  const formatValue = (val: number) => {
    return new Intl.NumberFormat("sk-SK", {
      style: "currency",
      currency: "EUR",
      notation: "compact",
    }).format(val);
  };

  return (
    <div className="w-full h-[400px] bg-white/5 border border-white/10 rounded-2xl p-6 mt-8">
      <h3 className="text-lg font-medium text-white mb-6">Analýza Trendu</h3>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={sortedData}
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff15" vertical={false} />
          <XAxis 
            dataKey="year" 
            stroke="#a3a3a3" 
            tick={{ fill: "#a3a3a3", fontSize: 12 }}
            tickMargin={10}
            axisLine={{ stroke: "#ffffff15" }}
            tickLine={false}
          />
          <YAxis 
            tickFormatter={formatValue} 
            stroke="#a3a3a3" 
            tick={{ fill: "#a3a3a3", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip 
            formatter={(value: any) => [formatValue(value as number), ""]}
            contentStyle={{ 
              backgroundColor: "rgba(23, 23, 23, 0.9)", 
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "12px",
              backdropFilter: "blur(8px)",
              color: "#fff"
            }}
            itemStyle={{ color: "#fff" }}
          />
          <Legend wrapperStyle={{ paddingTop: "20px" }} />
          <Line
            name="Zisk / Strata"
            type="monotone"
            dataKey="netProfitLoss"
            stroke="#6366f1" // Indigo-500
            strokeWidth={3}
            dot={{ fill: "#6366f1", r: 4, strokeWidth: 0 }}
            activeDot={{ r: 6, strokeWidth: 0 }}
          />
          <Line
            name="Prevádzkový Cash-flow"
            type="monotone"
            dataKey="operatingCashFlow"
            stroke="#10b981" // Emerald-500
            strokeWidth={3}
            dot={{ fill: "#10b981", r: 4, strokeWidth: 0 }}
            activeDot={{ r: 6, strokeWidth: 0 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
