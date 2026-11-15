# Known issues and limitations

**Audience:** players and contributors. This is the current list. Fixed items move to the [changelog](../../CHANGELOG.md). Actionable items should also exist as GitHub issues.

## Gameplay and rules
- **No half-time, added time or extra time.** Matches are one period. See the [rules matrix](../gameplay/FOOTBALL_RULES.md).
- **Offside nuances.** Only touching the ball counts as an offence ("interfering with play"). Any opponent touch resets offside, including deflections and saves.
- **Fouls.** No handball, holding or DOGSO judgements. Keepers are never sent off, because there is no substitute keeper.
- **11v11 chance creation** is still much lower per minute than small-sided play (about 0.6 shots a minute against 3 in 5v5). Attacks often stall 24–30 m from goal against a deep defence. Forwards now hold the last defender's shoulder and take spots in the box, but more varied support (third-man runs, overlapping full-backs) would help. `npm run report:attack` measures it.
- **AI crosses** reach a team-mate only some of the time (roughly 10–60% depending on level, over small samples).
- **Pass evaluation** is pessimistic about a marker standing behind the receiver.

## Saved data
- **Going back to an older version after earning a cup achievement.** Versions before the XI Nations Cup don't know the two cup achievements, so they can't read the newer progress record. They keep it as a recovery copy and start a fresh record, and nothing is deleted. This matters only to a site that rolls back to an older release (see [releasing](releasing.md)).

## Presentation
- **Limited character variety.** Two CC0 base bodies, five hairstyles (plus a beard and a shaved head) and seven hair colours. There is no curly hairstyle: none is available in the CC0 pack used, and no other asset has been verified.
- **Animation quality.** Celebrations, reactions and officials' signals are procedural poses over recorded clips. They were reworked to bend elbows and involve the body, but still need human review (see [playtesting](playtesting.md)).
- **Name labels:** only the controlled player has one.
- **Replays** don't record officials (they're hidden during replays).

## Platforms and verification
- **Not tested on real devices.** Real phones, tablets, controllers, fullscreen, older iOS audio and adaptive quality on real low-end and high-refresh hardware have not been verified. Automated checks use emulation.
- **GitHub Actions** workflows haven't yet run on GitHub.
