"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from "recharts";
import { useTheme } from "@mui/material/styles";
import { Box, Typography } from "@mui/material";

const ROW_HEIGHT = 36;
const MAX_NAME = 18;

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
        fullName: name,
        name: name.length > MAX_NAME ? name.slice(0, MAX_NAME - 1) + "…" : name,
        progress: total ? Math.round((done / total) * 100) : 0,
        done,
        total,
      };
    });

  if (data.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
        Progress appears here once you have a project.
      </Typography>
    );
  }

  const summary = data.map((d) => `${d.fullName}: ${d.progress}%`).join(", ");

  return (
    <Box role="img" aria-label={`Progress by project. ${summary}`}>
      <ResponsiveContainer width="100%" height={Math.max(96, data.length * ROW_HEIGHT + 8)}>
        <BarChart layout="vertical" data={data} margin={{ top: 4, right: 40, left: 0, bottom: 4 }} barCategoryGap={12}>
          <XAxis type="number" domain={[0, 100]} hide />
          <YAxis
            type="category"
            dataKey="name"
            width={132}
            axisLine={false}
            tickLine={false}
            tick={{ fill: theme.palette.text.primary, fontSize: 13 }}
          />
          <Tooltip
            cursor={{ fill: theme.palette.action.hover }}
            contentStyle={{
              background: theme.palette.surface.overlay,
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: 6,
              fontSize: 13,
              boxShadow: theme.tf.shadow.raised,
            }}
            labelStyle={{ color: theme.palette.text.primary, fontWeight: 600 }}
            itemStyle={{ color: theme.palette.text.secondary }}
            labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName ?? label}
            formatter={(value, _name, item) => [`${item.payload.done} of ${item.payload.total} tasks (${value}%)`, "Done"]}
          />
          <Bar
            dataKey="progress"
            barSize={10}
            radius={[0, 3, 3, 0]}
            background={{ fill: theme.palette.mode === "dark" ? "#332E22" : "#ECE8DD", radius: 3 }}
            isAnimationActive={false}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.progress === 100 ? theme.palette.success.main : theme.palette.primary.main} />
            ))}
            <LabelList
              dataKey="progress"
              position="right"
              formatter={(v) => `${v}%`}
              style={{ fill: theme.palette.text.secondary, fontSize: 12 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}
