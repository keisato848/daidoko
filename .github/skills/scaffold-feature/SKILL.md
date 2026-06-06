---
name: scaffold-feature
description: 'Use when planning a new feature surface across mobile, server, shared, and docs, or when generating a starting file map and implementation checklist.'
user-invocable: true
argument-hint: 'Provide a feature name and optional surfaces such as mobile,server,shared,docs'
---

# Scaffold Feature

## When To Use
- Before implementing a new feature that spans multiple packages.
- When the agent should propose a concrete file map instead of rediscovering the same structure.

## Procedure
1. Run `pnpm agent:scaffold -- --name <feature-name> --surfaces mobile,server,shared,docs`.
2. Use the generated file plan and checklist as the implementation anchor.
3. Keep the plan small and tie each surface back to the relevant docs before coding.