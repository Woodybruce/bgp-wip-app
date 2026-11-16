# Landsec pitch video: script and shot list (15 November 2026)

Woody's brief: a video for the Landsec pitch (w/c 23 and 30 November) showing
how the app works for them. Opens with Woody on camera, who then becomes a
stylised character that presents the app in Woody's own voice. The story is
Bluewater, and Jersey Mike's taking the Burger King unit.

Decided by Woody on 15 November 2026: filmed on a demo copy (nothing made up
goes on the live app); a stylised character; used both in the room and sent
ahead.

## The facts the story stands on (read from the live app, 15 November)

- Landsec view: 14 schemes, 1,121 units, 281 vacant, 109 live lettings.
- Burger King, Bluewater: unit L057, Lower Level, 3,147 sq ft, passing rent
  £264,537 a year, lease expiry 24 December 2028. Already on the Letting
  Tracker at Marketing with a Targeting Brief started.
- Bluewater's competing centres on the Brand gap board: Lakeside, The Glades
  Bromley, Canary Wharf, Westfield Stratford.
- Jersey Mike's: Expansion score 40 (Very hot). "Entering the UK", covenant
  grade A, a stated target of 400 sites across the UK and Ireland.
- Jersey Mike's is NOT on Bluewater's Brand gap target list today, because it
  does not yet trade at the competing centres. So the film introduces it as
  BGP's pick from the Brands side, not as a gap the board found.

Everything about the deal itself (the viewing, the offer, the Heads of Terms,
the recommendation) is made up for the film and is labelled "Illustration" on
screen.

## Script revised to Landsec's pitch pack (15 November 2026)

Woody sent Landsec's pitch pack, the pitch invitation and BGP's draft deck
("Landsec Dec 2026.pptx") on 15 November. The pack is confidential, so
neither it nor a summary of it is in the repo: Woody holds it. What Woody
decided that day:

- **The pitch is Thursday 3 December 2026, 15:00 to 17:00**, in person. The
  film has to be finished and sent with the presentation a clear day before,
  so by the afternoon of Wednesday 2 December, and it must play from a laptop
  file with no connection.
- **The cast** ("lets have mark warn"; "rob runs bluewater hes AM and mark is
  the leasing lead"; "charlotte and millie lead bluewater ben is the support
  but will help"): Mark Warne is Landsec's leasing lead and the login the
  film is shot in; Rob Hardie is Bluewater's asset manager; Charlotte Roberts
  and Millie Wilson lead Bluewater for BGP with Ben Sykes in support. Pablo
  Sueiras and Andrew Russell are not to be used. Ruth McFetridge and Charlie
  Griffiths attend the pitch and have no part in the film.
- **Where it sits in the deck**: under "why your agency", in place of the
  long ChatBGP text slide. The deck names the platform ChatBGP, so the film
  does too. About 2 minutes 45.

## The film is about the upgrade (Woody, 16 November 2026)

Woody, on the first cut to his voice: "they already have access to the app
and we've upgraded it". Landsec use the app today, so the film does not
introduce something new: it shows the upgraded version, with its Landsec
lean. His recorded intro says so in his own words ("we've upgraded and built
for you our app, which we use internally, and given it a Landsec lean ...
for them to see the upgrades that we've made"), and it replaces the scripted
opening below. Keep "we've upgraded" in any cut, and do not word a caption
or a card as if Landsec were seeing the app for the first time.

The cut to his voice is made by `script/pitch-video/voice-cut.cjs` from his
recording and a cut list (which stretches of the recording belong to each
scene, false starts and long pauses left out). His words are the script now;
the table below is the earlier written version. He also rewrote the close:
"We'd love to run it with you" was "too cheesy", and his close ends on
joining up the deal process so everyone can follow and comment.

## Presenters and the ending (Woody, 16 November 2026)

Woody, on the first voice cut: the placeholder character was "way too
basic"; he wants his avatar "more engaged and active on the screens", an
avatar of Charlotte Roberts "as BGP leasing lead" and one of Mark Warne "as
leasing lead for Landsec on Bluewater", and an ending where he flies off as a
superhero past a bat-signal-style light carrying the BGP logo, with a deeper
voice saying "Welcome to ChatBGP, your superhero app".

- **The look** (Woody, 16 November, on the first hand-drawn set: "these
  avatars are shit ... look like South Park and unflattering. I should be
  very handsome and Charlotte too"; "remove my glasses"; and, shown a flat
  comic-style drawing against a film-style render, "this is better I
  think"). The cast are clean comic illustrations made with the Gamma image
  generator from a description of each person's appearance only: no names
  and no photographs were sent to it. Charlotte is drawn polished and
  glamorous; she is not drawn "sexy" (a real colleague in a client film:
  her look is hers to choose).
- **The rig**: `script/pitch-video/avatars.html` lays a small rig over each
  drawing and `avatar-render.cjs` photographs it frame by frame. Woody's
  mouth follows the loudness of his voice, eyes blink, bodies sway; he has
  three forearms cut from his pose drawings (pointing, thumbs up, waving)
  that swing from the elbow, so his face never changes between gestures. The
  cut list says when each gesture happens, timed to his words. Charlotte and
  Mark do not speak; they appear with a name tag where the film is about
  them, and **dance when the Heads of Terms are signed** (Woody: "charlotte
  and mark should do some dancing when the HOTs are agreed").
- The drawings and their `rig.json` are kept outside the repo and passed as
  `AVATAR_ART`. `avatar-key.py` takes a drawing off its white background and
  `avatar-rig.py <folder>` builds the rig (the forearms, and where each
  mouth and eye is, read off the drawings by hand: a new drawing needs its
  figures put in that file).
- **Charlotte, Mark and David should each see the film before it goes to
  Landsec**: it is their likeness, and Mark is the client.
- Woody turns into his avatar at the end of the intro (his last picture
  shrinks into the corner as the drawing pops up). David Bell's arrival is a
  drawn scene: he flies in on wings and they hug.
- The ending is an original caped hero flying up through a searchlight that
  carries the BGP wordmark. It is deliberately not the Batman
  costume or emblem (another company's character, in a commercial pitch).
- The ending's line is a stock voice pitched down, because Woody has not
  recorded it. When he does, pass his take as `HERO_VOICE` and it is used in
  its place.
- Eye contact at the start: the opening fades up over the glance down. The
  recording is read from the screen throughout, which a cut cannot change.

### The opening and the sound (Woody, 16 November 2026)

Woody: "its probably easier if I quickly transform into the avatar ...
introducing Charlotte and Mark as examples but fixing the voice over. I could
just do the initial intro ... I'm on a viewing at Nova Victoria so perhaps we
should ask my better more efficient self to do it." So the film opens on his
own phone clip (`INTRO=<clip>` to `voice-cut.cjs`, cut to where he speaks,
his voice cleaned as the rest is; `INTRO_TEXT` is its caption), his last
picture folds up into the drawn Woody (`photo` on a drawn scene), and the
drawn Woody says the rest of the opening: the things he lists pop up as
labels (`cards`) and tick when he reaches AI, Charlotte arrives as the agent
and Mark as the client. Until the clip is in, "Hi, guys" from the Teams
recording stands in.

The sound, the same day ("consider the sound ... clean up some of the
fails"): the hesitations in the opening are cut out of the voice (found by
transcribing with the fillers kept, then placed against the loudness of the
recording; the cut list holds the times); each sentence of a line is placed
in its scene (`starts`), so a scene that outlasts its line has its quiet
between sentences and not all at the end; captions follow the sentence being
spoken (`caps`); and quiet made sounds (`sfx`: pop, chime, rush of air) mark
the turn into the drawing, an arrival and the dance. Nobody has listened to
the result on a build machine: each cut is checked by transcribing it again,
which finds a clipped or stray word but not a rough join.

The close is drawn too (Woody, the same day: "can you do the end too so it's
not me on camera?"): the drawn Woody says his close over labels (14 schemes,
Brands, Deals, one joined-up deal process), Charlotte, Mark and David join him
on "everyone", and the hero ending follows. Its hesitations are cut the same
way. Two of the first cuts there took a real word ("schemes", "help") in
place of the "er" beside it, and the transcript check caught both: always
transcribe a scene again after changing its cuts.

Woody's phone clip from Nova arrived the same evening (480 by 360, a
messaging copy: ask for the original file). His words: "Hi guys. I'm here to
tell you about ChatBGP, but unfortunately I'm in Nova, doing one of Victoria's
viewings for her. So maybe we allow my better, more prepared and aware self to
do it for me instead." He said the app's name wrongly in it ("it should say
chat BGP"), so one cut has the word replaced with his own "ChatBGP" from the
Teams recording, over a little of the clip's own street noise, and one keeps
the clip as he said it. Speech-to-text cannot tell the two words apart, so
which to use is his ear's call; a retake is the clean fix. The avatar's
opening is his short version (about 24 seconds), cut from the same recording.

## Two versions

- **Room cut**, about 2 minutes 45. Woody can pause it and talk.
- **Send-ahead cut**, the same film with captions burned in (most people watch
  with the sound off).

## Script

Voice lines are what Woody reads. About 420 words, roughly 3 minutes 20.

| # | On screen | Voice |
|---|-----------|-------|
| 1 | Woody to camera, filmed on his phone. Name caption. | "I'm Woody Bruce from Bruce Gillingham Pollard. You asked, why our agency. Part of the answer is something we've built for you, so let me show you rather than tell you. In fact, I'll get someone else to show you." |
| 2 | Woody turns into the character, who lands in the corner of the app. | "That's better. Mark, this is ChatBGP, and this is your login. One place for all fourteen schemes." |
| 3 | Properties: the 14 scheme cards, the stage pills, the map. Open Bluewater. | "Every unit, every vacancy and every live letting, counted the same way for your portfolio team, your asset teams, us and the other agents on the panel. Let's take Bluewater." |
| 4 | Bluewater: the plan and the tenancy schedule. Click the Burger King unit; the unit panel opens. | "The plan and the tenancy schedule are one thing. Click a unit and everything about it is there. This is Burger King on the lower level: three thousand square feet, with the lease ending in December 2028. Line up what comes next now, and there is no downtime." |
| 5 | Brand gap: the four figures, Targets, Competing centres, the Lakeside box. | "Differentiation starts with knowing what the competition has. The app tracks who trades at Lakeside, Stratford and Canary Wharf and not at Bluewater, and what those centres are doing each week." |
| 6 | Jersey Mike's brand page: Expansion score and the news behind it. | "And it tracks who is growing. Jersey Mike's: new to the UK, backed by Blackstone, with a stated plan for four hundred sites. A first to market for Bluewater, found on evidence." |
| 7 | The Targeting Brief on the unit. People tab. Mark presses Agree brief. | "Before anyone picks up the phone, the brief is agreed. Rent, incentives, target brands. Mark for leasing, Rob as asset manager, and Charlotte, Millie and Ben for us, each in their own login." |
| 8 | Letting Tracker. The offer typed as a plain note: "Offered: 15 year lease. Rent £275k pax and 9% t/o. 6 MRF". The form fills itself. | "Then it runs on the Letting Tracker. An offer comes in and we type it the way we'd say it. The app fills in the form and measures it against the brief." |
| 9a | Heads of Terms on Bluewater's own form. Mark signs off. | "Heads of Terms come out on Bluewater's own form, and everyone signs." |
| 9b | The deal checklist with a name against each step, then Deals showing "waiting on". | "From Heads of Terms the asset team takes over, with a name against every step. At any moment you can see what the deal is waiting on, and who." |
| 10a | The transaction recommendation in Landsec's template. Mark approves. | "The recommendation arrives in your own template, with Net Effective Rent worked out against ERV and the brief." |
| 10b | The calendar; the property conversation; a phone shot. | "Viewings, meetings and tasks sit in one place. So does the conversation on each property, for you and for every agent on the instruction." |
| 12a | David Bell flies in on fairy wings to meet the character. They hug. | "You also asked how we work with the other agents on the panel. Here comes one now. This is David Bell. And yes, we do like him." |
| 12b | David Bell's own login: one scheme (Liverpool ONE), its property page, a message in the conversation, his tracker. | "David gets his own login, with his schemes and nothing else. The same tracker, the same checklist, the same conversation. So you see one version of every deal, whoever did the work." |
| 13 | Woody walking, phone in hand. His iPhone screen: the app opens on ChatBGP ("Good evening, Mark") and he asks it a question. Then quick cuts: calling Jersey Mike's agent (Richard Wilcox, Etch) from his page; a comment on the Burger King unit after the viewing; the Argyll Street opening photos added to Jersey Mike's; a Liverpool ONE unit sent to Richard. | "And it all goes with you. Open it, and ask it a question. Call the brand's agent from his page. Log the viewing before you're back at your desk. Add the photos from the opening. And send him a unit on another scheme, there and then." |
| 14 | Woody, still walking, looks up from the phone. End card. | "That is one unit at one scheme. It runs the same way across all fourteen, so our time goes on brands and deals, not on chasing updates. We'd love to run it with you." |

The order (Woody, 15 November): start at the desk, and finish on Woody walking
with the phone, with the phone screens cut quickly because by then the viewer
knows the app.

Woody asked for the phone screens, the joint agent, David Bell flying in on
fairy wings and the hug on 15 November. On 16 November he took the "Tinker
Bell" name out of the voice: the wings are enough, and nothing on screen
says it. In the rough cut scene 12a is a plain
placeholder animation (two simple figures, not likenesses); the real
character art comes from the avatar service or an illustrator. David Bell is
the joint agent at Liverpool ONE, at Starka (Woody, 15 November, who also
said David is fine with being in the film). Woody records his intro, close
and voice from `docs/landsec-pitch-video-recording-sheet.md`.

## What Woody needs to do

1. **Record the intro and close to camera** (scenes 1 and 11). A phone held
   landscape at eye level, daylight on the face, a quiet room. Two or three
   takes of each.
2. **Record the voice for scenes 2 to 10.** Read the script once through in
   the same quiet room; a phone voice memo is good enough. A real recording
   sounds more like Woody than a cloned voice, and Landsec know his voice.
3. **Make the character.** Open an account with an avatar service (HeyGen and
   Synthesia are the two best known; check which offers a stylised or
   illustrated look today). They build the presenter from a short piece of
   footage and a consent clip, and most can be driven by an uploaded voice
   recording. Export the character clips with a plain green or transparent
   background.
4. Send the intro, the close, the voice recording and the character clips
   back. They are cut onto the app footage in this session.

## What gets built here

- The demo copy of the app, loaded so the Landsec login looks like the real
  thing for Bluewater, with the Jersey Mike's deal staged on it.
- The app footage: a scripted browser run, one clip per scene, timed to the
  voice lines above.
- A silent rough cut first, so the flow can be judged before any voice is
  recorded.
- The final cut: intro, character in the corner, captions, end card.

## Things to keep in mind

- **Burger King is a sitting tenant.** The film says "what comes next" for a
  lease ending in 2028; it never says Burger King is leaving. The send-ahead
  cut goes only to Landsec's own contact for the pitch.
- **Illustration label.** Scenes 8 to 10 carry a small "Illustration" mark.
- **Filmed as a Landsec login**, so BGP's fees, notes and other landlords'
  records are never on screen.
- The script needs to be fixed early in the week of 16 November to leave time
  for the character and the cut.

## Rough cut (15 November 2026)

A silent rough cut was made the same day (3 minutes 31 on the first script, about 3 minutes on the script above): the app footage for
scenes 3 to 10 with the voice lines as captions, and plain cards where Woody
and the character go. Scene 9 is two clips (Heads of Terms, then the
checklist and Deals) and scene 10 is two (the recommendation, then the
calendar).

How it is made (all on a local demo database called `bgpdemo`, never the
live app):

- `script/pitch-video/seed-demo.cjs` loads the demo copy from replies saved
  from the live app's own read-only API: every company, the 16 Landsec scheme
  records with their tenancy schedules, tracker units and deals (no fees, no
  BGP notes), leasing requirements, and Jersey Mike's record and signals.
  The saved replies are client data and are not in the repo.
- `script/pitch-video/stage-letting.cjs <phase>` stages the made-up letting
  through the app's own routes: `logins`, `brief`, `viewing`, `snapshot`,
  then `offer`, `hots`, `issue`, `recommendation` (and `tidy`, `reset`).
- `script/pitch-video/film.cjs <scene>` films one clip per scene with a drawn
  pointer: `properties`, `unit`, `gap`, `brand`, `brief`, `offer`, `hots`,
  `checklist`, `recommendation`, `calendar`. The order matters: film `brief`
  and `offer`, run the `offer` and `hots` phases, film `hots`, run `issue`,
  film `checklist`, run `recommendation` and `tidy`, film `recommendation`.
- `script/pitch-video/assemble.cjs` trims, captions and joins the clips.

What is real and what is not, in the rough cut:

- Real: the 14 schemes and their counts, Bluewater's schedule and plan, the
  Burger King unit, Jersey Mike's record and news, the brands and logos.
- The Brand gap board and the Lakeside box are the live app's own answers for
  Bluewater, replayed, because the demo copy holds too few store locations to
  work them out. They are cut to what a client login is sent.
- Made up, and marked "Illustration": the brief's terms, the viewing, the
  offer and its rounds, the Heads of Terms, the checklist and the
  recommendation.
- The people are real, by Woody's choice (the cast above). The names are one
  line each in the staging script.

Known rough edges to fix before the final cut:

- Jersey Mike's Expansion score reads 28 on the demo copy; it is 40 on the
  live app (the demo lacks its covenant grade and stated target). Its logo
  is missing on the demo.
- The Lakeside box says "Not researched yet": the weekly centre research has
  not run on the live app yet.
- The Heads of Terms draft shows the Bluewater form's unfilled blanks, and
  its history line reads "Jersey Mike's's agreed offer" (an app bug).
- The brief's People tab opens on the long "usual team" list; the calendar
  holds only the one viewing; the phone shot is not filmed.
- The footage is rough-cut quality. The final is re-filmed at higher quality
  once the script and timings are fixed to the recorded voice.
