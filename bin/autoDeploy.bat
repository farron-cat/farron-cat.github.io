call pnpm docs:build
cd docs/.viterpress/dist

git init
git add -A
git commit -m "auto construct blog"

git push -f https://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@github.com/farron-cat/farron-cat.github.io.git main:gh-pages