# Python reference model: Unit 1

Static site (no build step). Run locally:

    python3 -m http.server 8000
    # open http://localhost:8000

Check the snippet data against real Python after any edit:

    python3 tools/check_snippets.py data/snippets.json

Files
- index.html          page shell
- js/app.js           predict -> commit -> observe -> compare + explain -> feedback
- js/diagram.js       draws one step as an SVG memory diagram
- css/style.css       styles (light and dark)
- data/snippets.json  all learning content
- tools/check_snippets.py  validates the data
- .nojekyll           tells GitHub Pages not to run Jekyll
