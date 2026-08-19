# latex-quickmath

An [espanso](https://espanso.org) package for typing LaTeX maths quickly. 315 triggers for the
symbols you actually reach for — set theory, logic, analysis, algebra, probability, Greek letters,
matrix environments.

📖 **[Searchable cheatsheet](https://pagonix.github.io/latex-quickmath/)** — every trigger, what it
means, and how it renders.

```
:subseteq  →  \subseteq
:bbR       →  \mathbb{ R }
:bigcup    →  \bigcup_{ $|$ }^{  }{  }
:pmatrix   →  \begin{pmatrix} … \end{pmatrix}
```

## Install

Once it's on the [espanso Hub](https://hub.espanso.org):

```sh
espanso install latex-quickmath
```

Straight from this repo in the meantime:

```sh
espanso install latex-quickmath --git https://github.com/pagonix/latex-quickmath --external
```

## How it works

Every trigger starts with `:` and fires on the **trailing space**, so `:in ` expands but `:integral`
is left alone. Where a replacement has a `$|$`, that's where your cursor lands; the remaining
`{  }` are slots to fill in.

| Section | Contents |
| --- | --- |
| Brackets | `:c` `:r` `:s` — brace, round and square pairs |
| Set theory | membership, unions, blackboard-bold number sets |
| Logic | quantifiers, connectives, turnstiles |
| Relations | order, equivalence, divisibility |
| Arrows | plain, double and labelled arrows |
| Symbols & spacing | operators, dots, spacing |
| Greek & letters | the full Greek alphabet plus `\ell`, `\hbar`, `\aleph` |
| Analysis | limits, sums, integrals, derivatives |
| Linear algebra | det, rank, kernel, transpose |
| Algebra | Hom, GL, quotients, mod |
| Probability | ℙ, 𝔼, variance, convergence |
| Accents & fonts | accents, sub/superscripts, font commands |
| Delimiters | abs, norm, floor, ceiling, auto-sized pairs |
| Environments | align, cases, matrices |

## Repository layout

The package follows the espanso Hub structure, so it can be copied straight into a `espanso/hub`
fork under `packages/`:

```
latex-quickmath/
└── 0.1.0/                 # folder name matches `version` in the manifest
    ├── _manifest.yml
    ├── package.yml        # all 315 matches, grouped by "# -- Section --" comments
    └── README.md
docs/                      # the generated cheatsheet (GitHub Pages)
tools/                     # cheatsheet generator + per-trigger descriptions
```

## Cheatsheet

[pagonix.github.io/latex-quickmath](https://pagonix.github.io/latex-quickmath/) is a searchable
reference: every trigger with its meaning, its expansion and how it renders. It's served from
`docs/` by GitHub Pages — you can also just open `docs/index.html` in a browser.

To rebuild it after editing `package.yml`:

```sh
npm install katex
node tools/build-docs.mjs
```

Descriptions and examples live in `tools/meta/*.json`; the build warns about any trigger missing an
entry.

## Credits

Vibe coded with Claude Opus 5.
