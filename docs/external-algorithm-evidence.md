# External Evidence for the Revised P0–P2 Algorithm Roadmap

**Purpose:** This note preserves the external primary and authoritative sources consulted while planning the revised deterministic P0–P2 roadmap. It records only evidence relevant to algorithm selection and claim boundaries.

## Precedence-constrained knapsack

Boland, Bley, Fricke, Froyland, and Sotirov describe the **precedence-constrained knapsack problem (PCKP)** as a knapsack problem with pairwise precedence constraints. Their article studies polyhedral/cutting-plane methods for PCKP and distinguishes it from ordinary knapsack.[1] The source supports modelling general dependency-constrained episode retention as PCKP rather than assuming a tree structure.

Samphaiboon and Yamada’s article is titled *Heuristic and Exact Algorithms for the Precedence-Constrained Knapsack Problem* and explicitly identifies dynamic-programming/exact methods for PCKP.[2] Cho and Shaw’s tree-knapsack article is evidence for a tree-specific pseudo-polynomial dynamic program, not for applying tree DP to an arbitrary directed acyclic dependency graph.[3]

**Design consequence:** The SDK must use a general PCKP exact solver for the existing episode model. A rooted-forest detector may enable a tree-DP fast path, but it cannot be the default solely because episodes form a DAG.

## Structural requirements evidence

NASA defines traceability as an association among requirements, system elements, verifications, or tasks. Its requirements-management guidance calls for bidirectional traceability and explicitly requires traceability among parent/source requirements, lower-level requirements, design documents, and test plans/procedures.[4]

**Design consequence:** The proposed structural evidence graph uses explicit source-backed requirement, interface, dependency, acceptance, and test relationships. Its mandatory reachability closure is complete only relative to these validated graph links; absent links remain a graph-quality gap rather than proof that no dependency exists.

## Inverted-index routing

Manning, Raghavan, and Schütze describe Boolean processing over an inverted index. They state that two sorted postings lists can be intersected in `O(x + y)` operations and recommend processing conjunctive postings in increasing document-frequency order to reduce intermediate results.[5]

**Design consequence:** A discovery router can maintain deterministic, versioned sorted postings from exact affected references to consumer nodes and use intersections plus final policy checks. This is exact reference routing, not semantic similarity routing.

## Trust-property claim limits

Green, Karvounarakis, and Tannen’s provenance-semiring work is evidence that derivation provenance needs a stated representation and query semantics.[6] NIST FIPS 180-4 states the role of message digests in detecting changes to a message after digest generation; this is bit-level fixity evidence, not a proof of semantic truth or authoritativeness.[7]

**Design consequence:** The thesis language must refer to conditional operational surrogates: derivation provenance under a complete graph/query model; digest/reference fixity under a trusted baseline; finite policy authorization; and trace-policy accountability under complete, authentic, ordered logs and an explicit attribution model. It must not claim universal semantic fidelity, institutional legitimacy, or unique blame.

## References

[1]: [Boland et al., Clique-based facets for the precedence constrained knapsack problem](https://link.springer.com/article/10.1007/s10107-010-0438-7) "Mathematical Programming, 2012".

[2]: [Samphaiboon and Yamada, Heuristic and Exact Algorithms for the Precedence-Constrained Knapsack Problem](https://link.springer.com/article/10.1023/A:1004649425222) "Journal of Optimization Theory and Applications, 2000".

[3]: [Cho and Shaw, A Depth-First Dynamic Programming Algorithm for the Tree Knapsack Problem](https://doi.org/10.1287/ijoc.9.4.431) "INFORMS Journal on Computing, 1997".

[4]: [NASA Systems Engineering Handbook, Requirements Management](https://www.nasa.gov/reference/6-2-requirements-management/) "Requirements traceability and baselines".

[5]: [Manning, Raghavan, and Schütze, Processing Boolean Queries](https://nlp.stanford.edu/IR-book/html/htmledition/processing-boolean-queries-1.html) "Introduction to Information Retrieval".

[6]: [Green, Karvounarakis, and Tannen, Provenance Semirings](https://dl.acm.org/doi/10.1145/1265530.1265535) "PODS 2007".

[7]: [NIST FIPS 180-4, Secure Hash Standard](https://doi.org/10.6028/NIST.FIPS.180-4) "Message digest functions".
