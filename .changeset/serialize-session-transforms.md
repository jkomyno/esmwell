---
'esmwell': patch
---

Keep module-project and test-workspace source transforms in submission order within each session, including when a transform fails. Modules within a submission still transform concurrently, and run workers can overlap.
