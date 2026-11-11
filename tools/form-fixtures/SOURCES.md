# Form coach fixtures: sources and licences

The traces in `tests/traces/form/` hold **landmark numbers only** (33 points per frame from the pose model
`pose_landmarker_lite.f16`, tasks-vision 1.1.1, CPU, frame by frame at 30 fps, `tools/form-fixtures/extract.ts`).
No video is in the repository. The videos were downloaded on 11 Nov 2026 to a folder outside the repository
(`C:\Users\doruk\apps\_media\ba-form\clips\`, list with links in `clips.json` there). Which seconds of each video
were used is in `fixtures.json`; the hand labels are in `labels.json`.

Use: software testing of the form coach (does it count, does it colour the right part). Not used in any promo:
promo videos follow the rules in `takip/devir/bodyarcade-form/SPEC.md` 7.1 (stock people only with a correct-form,
green overlay; any red overlay only on our own footage with written consent).

| Source key (fixtures.json) | Video | Licence | Attribution |
|---|---|---|---|
| mixkit-52106 | https://mixkit.co/free-stock-video/a-young-woman-wearing-a-black-sportswear-outfit-performs-squats-52106/ | Mixkit Stock Video Free License (https://mixkit.co/license/#videoFree) | not required; "Video: Mixkit" |
| mixkit-52117 | https://mixkit.co/free-stock-video/a-young-woman-dressed-in-a-snugly-fitting-black-outfit-doing-52117/ | Mixkit Stock Video Free License | not required |
| mixkit-52116 | https://mixkit.co/free-stock-video/a-young-toned-woman-wearing-snugly-sportsware-doing-squats-at-52116/ | Mixkit Stock Video Free License | not required |
| mixkit-752 | https://mixkit.co/free-stock-video/woman-doing-squats-752/ | Mixkit Stock Video Free License | not required |
| mixkit-50762, mixkit-50761, mixkit-731 | https://mixkit.co/free-stock-video/a-young-man-doing-a-pushup-routine-on-the-balcony-50762/ , .../a-young-black-man-does-push-ups-on-the-balcony-50761/ , .../man-doing-push-ups-731/ | Mixkit Stock Video Free License | not required |
| mixkit-42899 | https://mixkit.co/free-stock-video/woman-exercising-with-small-dumbbells-42899/ | Mixkit Stock Video Free License | not required |
| commons-cdc-half-squat | https://commons.wikimedia.org/wiki/File:Muscle_Strengthening_at_Home_-_Half_squat.webm | Public domain (U.S. Centers for Disease Control and Prevention, a work of the U.S. federal government) | not required; "CDC, via Wikimedia Commons" |
| commons-cdc-push-ups | https://commons.wikimedia.org/wiki/File:Muscle_Strengthening_at_Home_-_Push-ups.webm | Public domain (CDC) | not required |
| commons-cdc-overhead-press | https://commons.wikimedia.org/wiki/File:Muscle_Strengthening_at_Home_-_Overhead_Press.webm | Public domain (CDC) | not required |
| commons-army-push-press | https://commons.wikimedia.org/wiki/File:Strength_Training_Circuit-_Overhead_Push_Press.webm | Public domain (U.S. Army, a work of the U.S. federal government) | not required; no endorsement implied |
| commons-interval-push-ups | https://commons.wikimedia.org/wiki/File:Interval_Push-ups.webm | CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/) | "Interval Push-ups" by Taco fleur, CC BY-SA 4.0, via Wikimedia Commons. The derived trace `pu-interval-side.trace.json` is shared under CC BY-SA 4.0. |
| commons-taco-fleur-kettlebell-goblet-squat | https://commons.wikimedia.org/wiki/File:Kettlebell_Goblet_Squat.webm | CC BY-SA 4.0 | "Kettlebell Goblet Squat" by Taco fleur, CC BY-SA 4.0, via Wikimedia Commons. The derived trace `sq-tf-goblet-front.trace.json` is shared under CC BY-SA 4.0. |
| commons-taco-fleur-squat-and-frontal-raise | https://commons.wikimedia.org/wiki/File:Squat_and_Frontal_Raise.webm | CC BY-SA 4.0 | "Squat and Frontal Raise" by Taco fleur, CC BY-SA 4.0, via Wikimedia Commons. The derived trace `sq-tf-frontraise-side.trace.json` is shared under CC BY-SA 4.0. |
| commons-taco-fleur-kettlebell-crush-grip-push-up | https://commons.wikimedia.org/wiki/File:Kettlebell_crush_grip_push-up.webm | CC BY-SA 4.0 | "Kettlebell crush grip push-up" by Taco fleur, CC BY-SA 4.0, via Wikimedia Commons. The derived trace `pu-tf-crush-side.trace.json` is shared under CC BY-SA 4.0. |
| commons-colossus-shoulder-press | https://commons.wikimedia.org/wiki/File:How_To_Properly_Dumbbell_Shoulder_Press.webm | CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/) | "How To PROPERLY Dumbbell Shoulder Press (LEARN FAST)" by Colossus Fitness, CC BY 3.0, via Wikimedia Commons; we use landmark numbers derived from two sections of it. |
| mixkit-52110 | https://mixkit.co/free-stock-video/a-young-woman-clad-in-black-workout-attire-exercise-at-52110/ | Mixkit Stock Video Free License | not required |
| mixkit-42898 | https://mixkit.co/free-stock-video/woman-exercising-in-her-living-room-42898/ | Mixkit Stock Video Free License | not required |
| mixkit-52112 | https://mixkit.co/free-stock-video/a-young-woman-clad-in-snugly-black-sportswear-doing-lunges-52112/ | Mixkit Stock Video Free License | not required |
| mixkit-42900 | https://mixkit.co/free-stock-video/woman-exercising-in-her-cozy-home-42900/ | Mixkit Stock Video Free License | not required |
| mixkit-52316 | https://mixkit.co/free-stock-video/a-young-shirtless-man-on-his-fitness-training-session-doing-52316/ | Mixkit Stock Video Free License | not required |
| mixkit-583 | https://mixkit.co/free-stock-video/woman-doing-warm-up-exercises-583/ | Mixkit Stock Video Free License | not required |
| mixkit-725 | https://mixkit.co/free-stock-video/man-jumping-rope-725/ | Mixkit Stock Video Free License | not required |
| mixkit-40234 | https://mixkit.co/free-stock-video/healthy-woman-jumping-a-rope-40234/ | Mixkit Stock Video Free License | not required |
| commons-army-forward-lunge | https://commons.wikimedia.org/wiki/File:Strength_Training_Circuit-_Forward_Lunge.webm | Public domain (U.S. Army, a work of the U.S. federal government) | not required; no endorsement implied |
| commons-cdc-toe-lift | https://commons.wikimedia.org/wiki/File:Muscle_Strengthening_at_Home_-_Toe_Lift.webm | Public domain (CDC) | not required |
| commons-taco-fleur-overhead-kettlebell-cossack-squats | https://commons.wikimedia.org/wiki/File:Overhead_Kettlebell_Cossack_Squats.webm | CC BY-SA 4.0 | "Overhead Kettlebell Cossack Squats" by Taco fleur, CC BY-SA 4.0, via Wikimedia Commons. The derived trace `cs-tf-cossack-front.trace.json` is shared under CC BY-SA 4.0. |
| commons-taco-fleur-kettlebell-racked-squats-side | https://commons.wikimedia.org/wiki/File:Kettlebell_Racked_Squats_(side_view).webm | CC BY-SA 4.0 | "Kettlebell Racked Squats (side view)" by Taco fleur, CC BY-SA 4.0, via Wikimedia Commons. The derived trace `sq-tf-racked-side.trace.json` is shared under CC BY-SA 4.0. |
| commons-jumping-jacks-and-burpees | https://commons.wikimedia.org/wiki/File:Jumping_jacks_and_burpees.webm | CC BY-SA 4.0 | "Jumping jacks and burpees" by Taco fleur, CC BY-SA 4.0, via Wikimedia Commons. The derived traces `jj-jb-front`, `bp-jb-front` and `bp-jb-side` are shared under CC BY-SA 4.0. |
| commons-crossfit-burpee | https://commons.wikimedia.org/wiki/File:CrossFit_Burpee.webm | CC BY-SA 4.0 | "CrossFit Burpee" by Taco fleur, CC BY-SA 4.0, via Wikimedia Commons. The derived trace `bp-crossfit-side.trace.json` is shared under CC BY-SA 4.0. |
| commons-basic-single-leg-squat | https://commons.wikimedia.org/wiki/File:Basic_single_leg_squat.webm | CC BY-SA 4.0 | "Basic single leg squat" by RickyBennison, CC BY-SA 4.0, via Wikimedia Commons. The derived trace `ps-single-leg-side.trace.json` is shared under CC BY-SA 4.0. |

Faz 3 (11 Nov 2026) added the standing moves' clips above (rows from mixkit-52110 on). Looked at and not used: Mixkit 52101
(a stretching flow, not lunge repetitions), 52108 (moving close-up), Commons "Jumping jack slow motion" (an insect) and
"Jumping jack movimiento" (an animated figure, not a person), the U.S. Army power jump and staggered squat jump clips (single
moves cut between close-ups), two "Aerobic exercise" group clips (many people in the picture), "Forward lunge training" (the
same footage as the U.S. Army forward lunge).

Not used: Coverr (its licence forbids using clips to evaluate models or in datasets), Mixkit clips under the
"Restricted License" (personal projects only), Pexels and Pixabay (their pages refuse automated download; candidates
are listed in `takip/devir/bodyarcade-form/VIDEO-KAYNAKLARI.md` for a manual download).

No freely licensed video of a **glute bridge** was found: that move is tested on geometry only until our own
recording exists (shooting list: SPEC.md 7.3).
