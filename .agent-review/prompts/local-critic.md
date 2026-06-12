<!-- DF-PROFILE: baseline -->
<!--
  PLACEHOLDER — optional custom critic prompt override.

  The Dark Factory CLI ships a BASELINE critic prompt internally, so this file is
  NOT required for the gate to run. It exists as a hook point: if you want to bias
  the critics toward this project's concerns (e.g. "this is an internal tax
  dashboard — weight data-correctness and PII handling findings heavily"), put
  those instructions below and reference this file from .agent-review/config.json.

  Until then it is intentionally empty of real doctrine. Do NOT add the
  `DF-PROFILE: calibrated` sentinel here — that namespace belongs to Momentiq's
  private prompt repo, not consumer overrides.

  See: https://github.com/momentiq-ai/dark-factory/blob/main/docs/CONSUMER-ADOPTION.md
-->
