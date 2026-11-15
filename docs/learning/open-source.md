# Learning open source with Open Clutch XI

**You'll learn:** how an open-source project works, and how to make your first contribution to one, using this game as the example. **Prerequisites:** a GitHub account, Git installed, and curiosity. No football or programming expertise needed for the first steps.

Open source means anyone can read, use, change and share the code under its licence (here the [Eclipse Public License 2.0](../../LICENSE)). People improve it together through **issues** (reports and ideas) and **pull requests** (proposed changes), reviewed in the open.

## 1. Understand the repository

A repository is the project's folder plus its whole history. Start with:
- **[README](../../README.md):** what the project is, how to run it, and how to help. Always read it first.
- **[CONTRIBUTING](../../CONTRIBUTING.md):** the project's working rules: setup, branches, commit messages, reviews.
- **[CODE_OF_CONDUCT](../../CODE_OF_CONDUCT.md):** how people treat each other here.
- **LICENSE and [NOTICE](../../NOTICE.md):** what you may do with the code, and who made what.
- **`src/`, `tests/`, `docs/`:** the game, its tests, its documentation. The [code tour](code-tour.md) shows how they fit together.

## 2. Run it on your computer

Follow *Play locally* in the README: clone, `npm ci`, `npm run dev`. If something fails, that's useful too. Note what happened: maybe the docs need fixing, which is a perfect first contribution.

## 3. Find a bug

Play with a critical eye:
- Does the keeper dive the wrong way?
- Does a menu ignore the keyboard?
- Does a celebration look robotic?
- Is a sentence in the docs wrong?

Much of the code was written with AI assistance, so expect some odd behaviour, and treat finding it as a skill worth practising. Professional developers spend much of their time reviewing code they didn't write.

## 4. Check whether it's already known

Search the [issues](https://github.com/chrisguindon/open-clutch-xi/issues), including closed ones, and the [known issues](../development/known-issues.md) page. If someone has already reported it, add a comment with anything new: another browser, clearer steps, a screenshot. Duplicates waste everyone's time, and a confirmation is still a contribution.

## 5. Write a useful issue

Use the **Bug report** form. A good report lets someone who wasn't there see the problem:
- **what happened**, and **what you expected**;
- **steps** to make it happen again;
- **where**: browser, device, game mode;
- **evidence**: a screenshot, or error messages from the browser console (F12).

You don't need to know the cause. *"In the XI Nations Cup on Firefox, after a draw in the quarter-final, the penalty button does nothing"* is far more useful than *"penalties broken"*.

## 6. Branches, in one minute

A **branch** is a separate line of work. You make your change on your own branch, so `main` stays stable while you experiment. On GitHub you **fork** the project (your own copy), create a branch there, and propose it back with a pull request.

```bash
git switch -c docs/fix-typo-in-controls     # create and move to a new branch
```

Name it after the change. If Git is new to you, GitHub's [Git guides](https://github.com/git-guides) and the free [Pro Git book](https://git-scm.com/book/en/v2) explain it well.

## 7. Make a small change

Smaller is better for a first contribution:
- fix a typo;
- clarify a confusing sentence;
- add a missing test;
- improve one label in the UI;
- pick a [starter issue](starter-issues/README.md).

One pull request should do one thing. If you use an AI tool, read and understand every line before you keep it. CONTRIBUTING has a short checklist.

## 8. Run the tests

```bash
npm test        # quick: unit and simulation tests
npm run ci      # everything the project checks on a pull request
```

Tests are how you show a change works and keeps working. When you fix a bug, a test that would have caught it is the best proof. Look in `tests/` for one that tests something similar, and copy its shape.

## 9. Open a pull request

Commit with a [Conventional Commit](https://www.conventionalcommits.org/) message (`docs(learning): fix the setup command`), push your branch, and GitHub offers to open a pull request. Fill in the template:
- what you changed;
- why;
- how you tested it;
- anything you weren't sure about.

Link the issue with "Closes #123". Automated checks then run on your change.

## 10. Code review

Someone reads your change and comments: questions, suggestions, sometimes requests for changes. That's normal, and it's how everyone improves, maintainers included. Answer the questions, push fixes to the same branch, and say when you've addressed a comment. If you disagree, explain why: reviews are discussions. You can review other people's pull requests too. Reading changes carefully and asking good questions is a contribution in itself.

## Why reviewing AI-written code is worth learning

AI coding tools are fast, fluent and frequently wrong in subtle ways: a plausible function that ignores an edge case, a comment that describes what the code should do rather than what it does, a test that passes without testing anything. Learning to read such code sceptically, check it against its tests and behaviour, and explain precisely what's wrong is valuable whether you write code by hand, with AI, or both. This repository gives you plenty of real material to practise on.

## Try it

- **Exercise:** find something in the game or docs that surprised you, check whether it's reported, and write the issue you would have wanted to read.
- **Exercise:** pick a test in `tests/`, break the code it tests on purpose, watch the test fail, then put it back. You now know what that test protects.
