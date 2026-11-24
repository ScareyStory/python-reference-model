# Python reference model (Units 1-3, with pre-test and post-test)

Static site (no build step). Run locally:

    python3 -m http.server 8000
    # open http://localhost:8000


The flow is:
    pre-test
    18 snippets
        Three units, 6 snippets each
    post-test.

Add ?tests=off to the URL to run the snippets alone.

Scores are shown on screen and never stored.

Files
- index.html               page shell
- js/app.js                predict -> commit -> observe -> compare + explain -> feedback
- js/diagram.js            draws one step as an SVG memory diagram
- css/style.css            styles (light and dark mode supported for accessibility)
- data/snippets.json       all learning content
- data/tests.json          pre-test and post-test items
- tools/check_snippets.py  validates the snippets against real Python
- tools/check_tests.py     validates the test items against real Python
- .nojekyll                tells GitHub Pages not to run Jekyll
