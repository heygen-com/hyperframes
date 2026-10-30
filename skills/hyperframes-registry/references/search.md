# Searching the catalog

How `hyperframes catalog` ranks, what its `--json` envelope means, offline behaviour, and reporting a miss.

Use the CLI as the primary discovery surface. **Search by intent before browsing:** the registry holds more items than you can scan by eye, so listing them and matching on names or tags is the slow path, and it fails whenever the author's wording differs from yours.

```bash
# Rank the whole catalog against what the beat should do
npx hyperframes catalog --query "reveal a headline one line at a time"
npx hyperframes add caption-clip-wipe
```

Search is local and sends nothing. By default it ranks on vocabulary shared with the item's name, title and description, so it only finds items that reuse your words; `--on-device` ranks by meaning instead, after a one-time model download. With `--json` the envelope names which tier answered, so check that rather than assuming a ranking happened.

**Always query in English, whatever language the video is in.** The catalog is written in English and both tiers index it that way (the on-device model is English-only too). A query in another script produces no searchable terms and returns nothing at all. This is easy to get wrong on a Japanese or Chinese project, where the brief, the captions and the narration are all in that language and the query naturally follows: describe the _move_ in English, then write the on-screen copy in whatever language the video needs. If a query does come back with `No searchable words in query`, that is this rule, not a missing component, and it is not worth a gap report.

Installability is applied after ranking, not before it: a name the vectors carry but this registry cannot serve is dropped from the results and counted in `dropped`, so a non-zero `dropped` means the two are different generations. The offline tier, the consent gate and refreshing a stale index are under "Search tiers" below.

To browse or filter instead of search:

```bash
npx hyperframes catalog
npx hyperframes catalog --type block
npx hyperframes catalog --type component
npx hyperframes catalog --type block --tag social
npx hyperframes catalog --json
npx hyperframes catalog --human-friendly
```

The normal table and `--json` modes only list matches; install a selected name with `hyperframes add <name>`. `--human-friendly` opens an interactive picker and installs the selected item immediately. In CI or agent workflows, prefer `--json` followed by an explicit `add`.

### Report what the catalog does not have

When the search comes back and nothing in it does the job, say so before you hand-author the move:

```bash
npx hyperframes feedback --search-miss "<the query you ran>" --wanted "<the move you needed>" --tier <the tier that answered>
```

`catalog --query` prints this line for you, pre-filled, and `--json` carries it as `report_gap` — so it is already in hand at the moment you decide nothing fits.

**Report whenever nothing in the results does the job, on either tier.** Do not wait for the on-device tier to have answered: it needs a consented 33 MB download, so an agent run is on `words` unless it explicitly opted in, and gating on `on-device` would silence almost every report. The `--tier` value rides along so a vocabulary miss stays distinguishable from a meaning miss when these are read. Describe the effect you wanted, not the item name you imagined: what comes back is a list of moves worth building, and a report naming a non-existent item teaches nothing. This is the only path that sends a query anywhere, which is exactly why it is a separate deliberate command rather than something the search does on its own. It carries no rating and never lands in the rating metric.

This is the whole demand signal for the catalog. Skipping it means the gap you hit gets guessed at from install counts instead, which cannot see a move nobody could install.

If the CLI cannot reach the configured registry, inspect the raw manifest as a fallback:

```bash
curl -s https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry/registry.json
```

A registry the CLI cannot reach does **not** empty the catalog for **discovery**: a previously fetched manifest keeps serving past its 24h refresh window whenever revalidation fails, so `catalog` and `catalog --query` still list and rank against the last copy on disk.

**`add` still needs the network, even for an item you installed yesterday.** Only manifests are cached; the item's actual files are fetched on every install. So offline you can search, and you can see what an item is, but installing it fails at the file fetch. Do not promise a user an offline install.

Each item's `registry-item.json` contains: name, type, title, description, tags, dimensions (blocks only), duration (blocks only), and file list.

See [discovery.md](./discovery.md) for details on filtering by type and tags.

## Search tiers

- **Search the catalog before writing motion by hand.** `npx hyperframes catalog --query "<the beat, in plain English>"`. Search is entirely local: there is no hosted tier, no account, and the query text is never sent anywhere. By default it ranks on vocabulary shared with the item's name, title, description and tags, which misses any phrasing that does not reuse the catalog's own wording. Add `--on-device` to rank by meaning instead (see the offline tier below).
- **Query in English even when the video is not.** Both tiers index an English catalog, so a query in another script produces no searchable terms and returns nothing. Describe the move in English; the on-screen copy stays in whatever language the video needs. `No searchable words in query` means exactly this and is not a missing component, so do not report it as a catalog gap.
- **Read which tier answered; never infer it from results appearing.** With `--json` the envelope carries `query`, `tier` (`on-device` or `words`), `tier_detail`, `dropped`, `unindexed`, `shown`, `total` and `results`, plus `top_score` when the answering tier produces one and `warnings` when a tier was asked for and could not run, or when a search returned nothing and a better tier is still waiting on someone's consent. A weak result on `words` is expected; the same result on `on-device` is a bug. `top_score` is on-device only and has no threshold behind it: the ranker returns the whole catalog in some order for every query, so read it as evidence rather than as a pass or fail.
- **`dropped` and `unindexed` are opposite skews between the registry and the on-device index, and rewording the query fixes neither.** `dropped` counts ranked names this registry cannot install, so the strongest matches are the ones being lost. `unindexed` counts registry moves the index cannot see at all, which no query can ever return. Refreshing the registry is not the answer to either: its manifest carries a 24h TTL and heals itself, while the vectors are a separately published artifact fetched into `~/.hyperframes/catalog/`. Re-running with `--on-device` refetches that index when `unindexed` is above zero, so that is the remedy to hand the user. A pure over-coverage skew (`dropped` above zero while `unindexed` is zero) does not trigger the refetch; clearing `~/.hyperframes/catalog/` is the only way out of that one. Both counts are of names rather than of results, so either can exceed `total`.
- **When a search comes back with nothing worth installing, say so.** `npx hyperframes feedback --search-miss "<the query you ran>" --wanted "<the move you needed>" --tier <the tier that answered>`. You do not have to assemble that line: `catalog --query` prints it pre-filled, and every `--json` search envelope carries it as `report_gap` with the query and tier already correct — fill in `--wanted` and send. This is the only path that sends a query anywhere, and it is a separate deliberate command precisely so plain `catalog --query` keeps its promise of sending nothing. **Report on either tier**, whenever the results do not do the thing; do not hold out for the on-device tier, which needs a consented 33 MB download and is therefore off in most agent runs — waiting for it means never reporting at all. The tier rides along in the report, so a vocabulary miss stays distinguishable from a meaning miss without you having to judge which one you hit. What comes back is a list of moves the catalog does not have yet, read directly rather than guessed from install counts, so the phrasing that matters is the effect you wanted, not the item name you imagined. It carries no rating and never lands in the rating metric.
- **Offer the offline tier; never enable it silently.** A one-time ~33 MB download (a quantized ONNX build of `bge-small-en-v1.5` plus its tokenizer, pinned to a fixed revision) and the catalog vectors from the registry, both cached under `~/.hyperframes/`, neither added to the project or any package. Once cached it ranks by meaning with nothing sent. Say the size out loud and let the person decide, then pass `--on-device` (with `-y` to skip the prompt) once they agree. The interactive offer only fires on a TTY. Under `--json` there is no prompt, but a search that found nothing puts the same ask in `warnings`, so read that array and put the decision to the user yourself. When the person asks what the download is, why this model, or what leaves the machine, point them to https://hyperframes.heygen.com/developers/catalog-search.
