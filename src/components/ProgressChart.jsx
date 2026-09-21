"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { useTheme } from "@mui/material/styles";
import { Typography } from "@mui/material";

export default function ProgressChart({ projects }) {
  const theme = useTheme();

  // The props come from toProjectDTO(), which always supplies `tasks`,
  // `columns` and `name` — but a single malformed entry (or a missing
  // `projects` prop) used to throw during render, and because this is a
  // client component that takes the whole dashboard down with it rather
  // than just the chart. Missing pieces now count as "none" instead.
  const data = (Array.isArray(projects) ? projects : [])
    .filter(Boolean)
    .map((p) => {
      const tasks = Array.isArray(p.tasks) ? p.tasks : [];
      const columns = Array.isArray(p.columns) ? p.columns : [];
      const total = tasks.length;
      const doneColumnIds = new Set(columns.filter((c) => c?.isDoneColumn).map((c) => c.id));
      const done = tasks.filter((t) => doneColumnIds.has(t?.columnId)).length;
      const name = typeof p.name === "string" && p.name ? p.name : "Untitled";
      return {
        name: name.length > 14 ? name.slice(0, 14) + "…" : name,
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
