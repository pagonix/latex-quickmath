# LaTeX Quickmath

315 expansions for writing LaTeX maths: set theory, logic, relations, arrows, Greek letters,
analysis, linear algebra, algebra, probability, accents, delimiters and matrix environments.

Every trigger starts with a `:` and fires on the following space, so `:in ` expands while typing
`:integral` leaves your text alone.

```
:subseteq  →  \subseteq
:bbR       →  \mathbb{ R }
:sum       →  \sum_{ }^{ }
:pmatrix   →  \begin{pmatrix} … \end{pmatrix}
```

Some replacements leave your cursor in the first spot you need to type — the lower bound of a sum,
the numerator of a fraction — and any remaining `{  }` are empty slots to fill in yourself.

The full list, with each symbol's meaning and how it renders, is at
<https://pagonix.github.io/latex-quickmath/>.

Plain text replacements only — this package runs no scripts and no shell commands.
