"use client";

import { useId } from "react";
import { Box, TextField } from "@mui/material";

// Labels sit above the control, in the flow of the form, instead of
// floating inside the outline. That keeps the label readable while the
// field is filled, and lets helper text and errors line up underneath.
export function FieldLabel({ id, htmlFor, optional = false, component = "label", children, sx }) {
  return (
    <Box
      component={component}
      id={id}
      htmlFor={component === "label" ? htmlFor : undefined}
      sx={{ display: "block", mb: 0.75, fontSize: "0.8125rem", fontWeight: 600, color: "text.primary", ...sx }}
    >
      {children}
      {optional && (
        <Box component="span" sx={{ ml: 0.75, fontWeight: 400, color: "text.secondary" }}>
          Optional
        </Box>
      )}
    </Box>
  );
}

// A text (or `select`) field with its label above. Everything else is
// passed straight through to MUI's TextField.
export default function Field({ label, optional, id, sx, select, SelectProps, ...props }) {
  const reactId = useId().replace(/:/g, "");
  const fieldId = id || `field-${reactId}`;
  const labelId = `${fieldId}-label`;

  return (
    <Box sx={sx}>
      <FieldLabel
        id={labelId}
        htmlFor={fieldId}
        optional={optional}
        component={select ? "div" : "label"}
      >
        {label}
      </FieldLabel>
      <TextField
        id={fieldId}
        fullWidth
        select={select}
        SelectProps={select ? { labelId, ...SelectProps } : SelectProps}
        {...props}
      />
    </Box>
  );
}
