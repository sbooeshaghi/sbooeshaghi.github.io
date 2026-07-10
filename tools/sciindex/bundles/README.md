# Bundles

A bundle is the portable unit used to build a sciindex. It contains:

- one `recipe.json` defining accepted objects, connections, sources, and checks;
- one or more agent tasks with a prompt, output schema, preparer, and validator;
- a small manifest naming those files.

Tasks produce candidates. A validator report is the only accepted handoff to a
dataset adapter. The generic `sciindex` binary reads the resulting resource
index and does not know about recipes or agents.

Dataset-specific paths and import rules belong in the dataset repository, not
inside a reusable bundle.
