# RAG source documents

Drop `.md` or `.txt` files here — e.g. CVA6/X-Interface specs, SkyWater 130nm PDK documentation,
RISC-V manuals — then trigger ingestion:

```
POST /api/rag/ingest
```

This re-scans this folder and (re-)embeds every `.md`/`.txt` file into the configured Qdrant
collection (see `rag` in `config/app.json` / the `AppConfig` schema for embedding model, chunk
size, and collection settings). Requires a reachable Qdrant instance — check `GET /api/rag/status`
first.

This folder is git-ignored; only this README is checked in.
