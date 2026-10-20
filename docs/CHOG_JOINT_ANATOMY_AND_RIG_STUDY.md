# Human Joint Anatomy Study for the Chog Character Rig

**Purpose:** document the useful anatomy and movement principles for improving Chog Fight Club's existing 2D articulated character. This is a visual-animation reference, not a medical model and not a guide to real-world fighting. The design target is a readable, stylized Chog that feels connected and balanced while retaining its original NFT artwork.

## 1. What the game actually has today

The main visual rig is in `src/game/chogRig.js`. It is a **2D sprite rig**, not a 3D skeleton: separated, full-canvas artwork layers are rotated around carefully chosen pivots.

The current rig contains 16 artwork layers: body; head, eyes, and mouth; left/right upper arm, lower arm, and hand; and left/right upper leg, lower leg, and foot. The pivots are defined in one normalized 1024-unit canvas and all layers render at 250 units before the scene's overall scale. Those shared-canvas coordinates are important: changing a PNG's individual offsets, origin, or scale can break the character's rest-pose alignment.

The existing articulated chains are:

- **Shoulder → elbow → wrist/hand:** the upper arm rotates around its shoulder pivot, the elbow position follows that upper-arm transform, and the hand is placed by extending from the transformed elbow.
- **Hip → knee → ankle/foot:** the thigh rotates around its hip pivot, the knee follows, and the foot is placed from the transformed knee.
- **Torso → head/face:** the head, eyes, and mouth stay aligned while following torso movement, with small separate head offsets and rotation.

The tests in `src/game/chogRig.test.js` already protect part alignment, parent-joint propagation, the transformed elbow-to-wrist connection, the transformed knee-to-ankle connection, the jab endpoint, and the jump's tucked-leg silhouette. These are valuable regression tests and should be extended rather than replaced.

Two independent presentation paths use this rig: `src/main.js` for solo practice and `src/liveArena.js` for online matches. Both define their own guard, movement, attack, jump, reaction, and defeated poses. Their visual language can drift unless pose rules are kept conceptually aligned.

## 2. Anatomy: what connects to what

Real joints are not all interchangeable hinges. The surface shapes, ligaments, surrounding muscles, and joint capsule determine what a joint can do and how stable it is. For animation, the goal is not to simulate every anatomical structure; it is to give each pivot the correct *kind* of motion and make the linked segments remain connected. OpenStax provides a clear overview of synovial joint types and movement terms ([Types of Body Movements](https://openstax.org/books/anatomy-and-physiology/pages/9-5-types-of-body-movements); [Joints and Skeletal Movement](https://openstax.org/books/biology/pages/38-3-joints-and-skeletal-movement)).

### Shoulder and shoulder blade

The shoulder is not one simple hinge. The arm's range comes from a coordinated shoulder complex involving the humerus, scapula, and clavicle. The scapula moves relative to the rib cage while the arm moves at the shoulder joint; this coordination lets the shoulder remain aligned as the arm rises or reaches. See the [Radiographics review of scapulothoracic movement](https://pubs.rsna.org/doi/10.1148/rg.240097) and [NCBI's review](https://pmc.ncbi.nlm.nih.gov/articles/PMC3863500/).

**For Chog:** keep the shoulder pivot attached to the body/torso frame, but allow a *small* shoulder translation or shoulder-area offset during reaching, guarding, jumping, and reacting. Let torso movement contribute to the arm's path. Do not make the upper arm look as though it spins independently at a floating dot. Because the art does not contain a separate scapula or clavicle, suggest this motion with a few pixels of shoulder/upper-arm movement rather than adding imaginary bone layers.

### Elbow, forearm, wrist, and hand

The elbow complex primarily bends and straightens. Forearm rotation is also possible through the radius/ulna, so the direction the palm or fist faces can change without the upper arm rotating in exactly the same way. The [NCBI Bookshelf elbow anatomy review](https://www.ncbi.nlm.nih.gov/books/NBK532948/) describes the elbow complex and the combined movements of flexion/extension and pronation/supination. The wrist supports smaller, combined motions; it should not behave like a second shoulder.

**For Chog:** treat the elbow as a preferred one-plane hinge in this side-view 2D rig. Give it a predictable local bend value for each pose, and prevent abrupt sign changes or implausible bends through calibrated pose-space limits. Let the fist/hand angle follow the forearm by default, then use a small independent hand-angle adjustment only when it improves the silhouette. Never let the elbow or wrist teleport to a new point: the hand endpoint must always be derived from the *transformed* elbow.

The rig already makes lower-arm angle a local additive offset: final forearm orientation includes torso rotation + upper-arm rotation + lower-arm offset. Pose authoring must respect that convention rather than treating the lower-arm value as a world-space angle.

### Spine, torso, pelvis, neck, and head

The trunk is a linked column, not a single rigid board. The pelvis supports the body's mass; the torso can rotate or lean over it; the neck and head make smaller adjustments to keep the character's attention readable. Real movement may distribute rotation across several joints, but a stylized game can imply the pattern without modelling every vertebra.

**For Chog:** the artwork currently has one main body layer, not separately rigged pelvis, abdomen, chest, and neck. Preserve that visual design. Use restrained torso rotation/translation, counter-movement of the head, and coordinated limb poses to imply balance. Do not add many independent pivots unless the actual art is first split into appropriate layers—otherwise the character will look disconnected or the sprite will shear.

### Hip, thigh, knee, ankle, and foot

The hip is a ball-and-socket joint with multi-directional movement; the knee behaves mostly like a hinge during common flexing and straightening; and the ankle allows the foot to move relative to the shin. The ankle/foot also helps the body settle onto the floor and absorb the visual impression of landing. OpenStax's joint review explains the distinction between multiaxial hip motion and the more constrained knee and ankle motions ([Chapter Review](https://openstax.org/books/anatomy-and-physiology/pages/9-chapter-review)).

**For Chog:** the hip should follow the torso but the thighs need their own controlled angles. The knee should fold in a consistent direction; it should not invert unpredictably when the character switches from idle to jump or hit reaction. Let the foot inherit the lower leg's movement, but allow a small extra foot rotation or landing adjustment if necessary. For standing and walking, preserve a believable relationship to the floor; if the foot shifts, the rest of the leg should explain that shift rather than leaving the foot skating.

### Joint categories to keep in mind

| Body region | Useful anatomical model | 2D animation approximation |
|---|---|---|
| Shoulder complex | Multi-axis motion plus scapular/clavicular coordination | Torso-parented pivot with small offsets and coordinated torso motion |
| Elbow | Mostly hinge-like bend/straighten | One main local rotation with a preferred bend direction |
| Forearm | Rotation changes palm/fist orientation | Optional small rotation cue; avoid a detached wrist |
| Wrist/hand | Smaller combined rotations | Hand follows the forearm plus subtle angle adjustment |
| Spine/trunk | Motion distributed across linked joints | One body pivot now; restrained lean and head counter-motion |
| Hip | Multi-axis ball-and-socket | Independent thigh rotation parented to body |
| Knee | Mostly hinge-like flex/extend | One local lower-leg angle with a consistent bend direction |
| Ankle/foot | Foot orientation changes relative to shin | Foot follows lower leg, with optional small landing/plant adjustment |
| Neck/head | Head can counter-move relative to trunk | Existing head pivot/offset; keep eyes and mouth locked to the head |

## 3. How this should look in the game's existing states

These are presentation goals for a fictional character, not additional gameplay rules.

### Idle and guard

The pose should look supported, not frozen: very small torso/head motion is enough. Keep both hands near the same deliberate guard area and avoid swinging the arms as if they were hanging from loose strings. Weight shifts should be subtle and should not move the feet far enough to make a standing Chog slide.

### Walking and turning

Legs should alternate, with the knee folding on the lifting phase. The body can bob slightly, but avoid making every limb reach its maximum angle at once. The arms counter-balance the legs with smaller motion while maintaining the guard. When a fighter changes facing, mirror the whole rig as the project already does; don't also reverse every pose angle, which would double-flip the movement.

A more reliable future stride uses the distance actually travelled to advance the gait phase and a planted-foot phase to limit foot sliding. The current code uses procedural stride values, which are suitable for a prototype but should be tuned against ground contact and at low frame rates.

### Reach, attack, and return to guard

The visual sequence should read in three broad stages: preparation, extension/contact, and return. The torso and shoulder-area movement should support the arm, then the elbow and hand should follow the same connected chain. The non-active arm should remain purposeful rather than hanging limp. Use easing and clean endpoint paths; avoid abrupt jumps in joint angles.

Important multiplayer constraint: **the server remains the authority for action timestamps, hit windows, damage, health, and match state.** The rig is client-side presentation. Visual pose changes must not become a second source of combat truth, and animation edits must not move hitboxes or alter the combat rules. In the realtime path, the server's attack windows and the visual strike peak should remain aligned. The single-player state machine has its own startup/active/recovery phases, so the two renderers need matching visual timing even if their internal implementations remain separate.

### Jump and landing

A jump should show a clear change in support: the root rises, both legs bend rather than dangling straight, and the feet tuck under the body. On descent, the legs should open enough to reconnect visually with the floor. A tiny body compression or rebound can sell the landing. Keep the visual feet consistent with the actual jump/root position; animation must not create a fake gameplay evade window.

### Hit reaction and knockout

A hit reaction should pass through a readable recoil and then settle back into guard. Avoid applying the same equal-and-opposite rotation to every part: the body can react first, with the head and limbs following slightly later. A knockout pose should communicate loss of support through a staged lean/fall and final settle, not only a permanently bent standing pose. The final KO remains a match-state decision; the animation cannot decide who won.

## 4. Rigging principles that are especially important here

1. **Keep a clear parent-child chain.** A shoulder controls the upper arm, which determines the elbow position; the elbow controls the forearm, which determines the wrist/hand. Apply the same principle from hip to knee to ankle. This is the basic principle of a skeleton hierarchy described in [Autodesk Maya's documentation](https://help.autodesk.com/cloudhelp/2026/ENU/Maya-CharacterAnimation/files/GUID-DC88B9A7-593B-427E-9BED-4D7822B0E0B6.htm).
2. **Preserve the rest pose.** The current PNGs share a normalized canvas. Do not change per-layer origins, display sizes, pivots, or imported offsets as a quick fix for a bad pose. Adjust local pose angles and offsets first, and add regression tests.
3. **Use local angles consistently.** Shoulder/hip values are offsets relative to the torso; elbow/knee values are offsets relative to the upper segment; the hand/foot should follow the terminal segment. Any constraints need to operate on these local values.
4. **Prefer limits to arbitrary per-frame fixes.** Define calibrated, stylized ranges for shoulder, elbow, hip, knee, head, and foot pose values. These are rig-space limits based on the supplied artwork, not medical range-of-motion numbers. Clamp or validate authored pose values once, in a predictable place.
5. **Keep animation continuous.** Blend between state poses instead of switching instantly. Drive action poses from timestamps/progress so delayed network snapshots do not give clients different pose meanings. Keep action phases synchronized with the existing server state.
6. **Separate visual and gameplay truth.** Sprite layers, joint angles, and fall poses are presentation. The backend's movement state, cooldowns, jump timing, collision checks, HP, KO, and round result stay authoritative and unchanged during an art pass.
7. **Test endpoints, not only angles.** A plausible angle does not guarantee a good silhouette. Assert that the wrist remains at the correct point relative to the elbow, the ankle remains related to the knee, the feet remain visually grounded in planted poses, and both mirrored fighters produce equivalent shapes.
8. **Respect Chog proportions.** Human anatomy is a reference model, not a mandate to turn Chog into a realistic human. Keep its original body shape and NFT traits; borrow the human principles of connected joints, controlled bends, balance, and follow-through.

A full inverse-kinematics system is not the first step. The current forward-kinematics chain works and is already tested. First centralize/validate pose limits, align the solo and online pose timing, improve foot contact, and add visual regression checks. Only consider 2D inverse kinematics if future animations need to place a fist or foot at a target position while keeping segment lengths stable.

## 5. Prioritized recommendations

### Priority 1 — preserve the existing rig
- Keep every existing sprite, shared-canvas alignment, root mirror convention, hitbox, and backend contract untouched.
- Add named pose constraints/ranges in rig space and unit tests for boundary behaviour, so new poses cannot accidentally produce inverted elbows/knees or wildly displaced hands/feet.
- Add a test that applies the neutral pose and confirms no visible gap or unexpected offset at each elbow, wrist, knee, and ankle.

### Priority 2 — make both modes visually consistent
- Define one shared vocabulary for the guard, walk, jump, strike, recoil, and KO pose shapes.
- Match the visible strike/contact peak to the already-authoritative hit windows in each mode.
- Keep the server-provided action start/end timestamps as the animation clock for live play; don't add a frontend timer that changes combat outcomes.

### Priority 3 — improve contact and weight
- Reduce foot sliding by making the grounded foot less mobile during its planted phase.
- Add a small landing compression and staged KO fall/settle.
- Keep torso and head follow-through subtle enough to preserve the stylized character's read at its small on-screen size.

### Priority 4 — validate before deployment
- Run `npm test` and `npm run build`.
- Add pose tests for idle, both facing directions, full extension, crouched/tucked jump, landing, hit reaction, and KO.
- Manually inspect solo and two-browser online matches at normal speed and reduced frame rate. Check that artwork stays connected and the visible contact roughly matches the server's hit events.
- Keep changes to animation assets and rendering in the frontend code. No Cloudflare Worker, D1, session, invitation, or Pact contract changes are needed for this visual study.

## 6. References

- OpenStax, [Types of Body Movements](https://openstax.org/books/anatomy-and-physiology/pages/9-5-types-of-body-movements) — how joint type affects movement.
- OpenStax, [Joints and Skeletal Movement](https://openstax.org/books/biology/pages/38-3-joints-and-skeletal-movement) — joint classes, movement categories, and stability.
- OpenStax, [Chapter Review: Anatomy and Physiology](https://openstax.org/books/anatomy-and-physiology/pages/9-chapter-review) — hip, knee, ankle, elbow, and forearm movement distinctions.
- Radiographics/RSNA, [Scapulothoracic Disorders: Anatomy, Kinematics, Clinical Assessment, and Multimodality Imaging](https://pubs.rsna.org/doi/10.1148/rg.240097) — coordination of shoulder-complex joints and scapular motion.
- NCBI Bookshelf, [Anatomy, Shoulder and Upper Limb, Elbow Joint](https://www.ncbi.nlm.nih.gov/books/NBK532948/) — elbow joint structures and the combined elbow/forearm movements.
- National Library of Medicine / PMC, [Scapulothoracic Anatomy and Snapping Scapula Syndrome](https://pmc.ncbi.nlm.nih.gov/articles/PMC3863500/) — why the shoulder is a coordinated complex rather than one hinge.
- Autodesk Maya, [Skeleton hierarchy](https://help.autodesk.com/cloudhelp/2026/ENU/Maya-CharacterAnimation/files/GUID-DC88B9A7-593B-427E-9BED-4D7822B0E0B6.htm) — parent-child transformation hierarchy.
- Unity Manual, [Humanoid asset preparation](https://docs.unity.cn/2018.3/Documentation/Manual/UsingHumanoidChars.html) — common anatomical bone hierarchy and rig/skinning fundamentals.
