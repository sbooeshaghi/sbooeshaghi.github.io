# Summary task

This task consumes accepted atomic claim IDs and statements. It produces one
concise paper description plus the claim IDs that support it. The summary is
therefore grounded transitively through accepted claims to exact paper spans.

The validator checks artifact hashes, task provenance, claim existence, and
duplicate claim references. Semantic faithfulness remains an LLM task; code
does not pretend to prove entailment.
