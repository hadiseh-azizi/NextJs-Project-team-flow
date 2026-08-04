"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { useTheme } from "@mui/material/styles";
import { Typography } from "@mui/material";

export default function ProgressChart({ projects }) {
  const theme = useTheme();

  const data = projects.map((p) => {
    const total = p.tasks.length;
    const doneColumnIds = new Set(p.columns.filter((c) => c.isDoneColumn).map((c) => c.id));
    const done = p.tasks.filter((t) => doneColumnIds.has(t.columnId)).length;
    return {
      name: p.name.length > 14 ? p.name.slice(0, 14) + "…" : p.name,
      progress: total ? Math.round((done / total) * 100) : 0,
    };
  });

  if (data.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 4 }}>
        You haven't created any projects yet — start from the Projects page.
      </Typography>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 8 }}>
        <XAxis dataKey="name" stroke={theme.palette.text.secondary} fontSize={12} />
        <YAxis stroke={theme.palette.text.secondary} fontSize={12} unit="%" domain={[0, 100]} />
        <Tooltip
          contentStyle={{
            background: theme.palette.background.paper,
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 6,
            fontSize: 13,
          }}
          formatter={(value) => [`${value}%`, "Progress"]}
        />
        <Bar dataKey="progress" radius={[4, 4, 0, 0]}>
          {data.map((entry, i) => (
            <Cell
              key={i}
              fill={entry.progress === 100 ? theme.palette.success.main : theme.palette.primary.main}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
