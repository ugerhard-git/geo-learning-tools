# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub's
[private vulnerability reporting](https://github.com/ugerhard-git/geo-learning-tools/security/advisories/new)
rather than in a public issue. Include what you found, how to reproduce it,
and which page it affects.

## What the apps protect

The apps are static pages with no server or accounts. The things worth
protecting are:

- **An optional REST Countries API key**, which a learner may choose to
  remember in their browser.
- **Learning progress** stored in the browser.
- **The integrity of the pages themselves**, which render text fetched from
  Wikipedia, Wikidata and REST Countries.

Every page carries a strict Content-Security-Policy that allows only its own
script to run and limits network access to the services listed in the
README.
