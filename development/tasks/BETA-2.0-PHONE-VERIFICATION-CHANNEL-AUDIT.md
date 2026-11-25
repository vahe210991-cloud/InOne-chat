# Agent Task: International Phone Verification Channel and Provider Cost Audit

**Task ID:** B2-ID-PHONE-CHANNEL-AUDIT  
**Parent:** Beta 2.0 Identity #137; phone policy #151  
**Mode:** Research and architecture audit only. No implementation.

## 1. Context and approved policy

InOne is an international product, not an Armenia-only service. The product owner approved on 2026-11-25 that phone is optional for every Beta 2.0 Identity registration method, including email/password and Google/Apple. A verified email/provider email can establish initial identity but is not phone verification. Phone is an independent optional identifier and optional additional contact/recovery channel. Phone-based recovery is allowed only after separate successful phone verification and under an approved recovery policy. This decision does not authorize changing Beta 1.0 behavior or INONE_REQUIRE_PHONE.

The owner proposed investigating a low-cost automated-call flow: call the submitted phone number and let the user enter the last six digits of the incoming caller-ID number (flash call / missed-call verification). Treat this strictly as a research hypothesis, not a design decision.

## 2. Objective

Produce a decision-grade, source-backed comparison of:
A. Flash-call / missed-call verification using caller ID and last-six-digits.
B. Automated voice OTP (spoken code).
C. SMS OTP.
D. Hybrid routing by country, operator coverage, delivery, risk and total cost.
E. Any genuinely free or near-free approach that is lawful, scalable and commercially viable internationally.

Find the cheapest credible global providers/aggregators with an ongoing free tier, free trial, free monthly allowance or other documented no-cost allowance. Clearly distinguish ongoing production free tier, temporary trial credit, sandbox-only testing and promotional credit. Establish who actually pays carrier origination and termination charges.

## 3. Flash-call feasibility and security

Investigate:
- Exact call flow: outbound call, missed/answered call, caller-ID display, user input, call duration and required device behavior.
- Whether recipient is charged in relevant countries/operators; who pays origination and termination.
- Whether caller ID is guaranteed visible, non-anonymous, stable and unchanged across international carriers.
- Caller-ID spoofing/rewriting, number masking, local-number substitution, roaming, number portability, VoIP, landlines, dual-SIM, forwarding, withheld CLI, spam filtering and carrier blocking.
- Entropy of six digits; brute force, replay, harvesting, code reuse, collisions and limited/reused caller-number pools.
- SIM swap, port-out, PBX/VoIP routing and compromised carrier signaling.
- Binding the attempt to account, phone claim, nonce, destination, expiry and one-time use.
- Whether it proves control of the destination number or only receipt of a call on a device.
- Automated-call, caller-ID integrity, consent, do-not-call, telecom licensing, privacy and retention rules by country.

Do not treat caller ID as cryptographic proof. Give an explicit go/no-go for last-six-digits as a standalone factor, and assess whether it is unsuitable for high-risk account recovery.

## 4. International coverage matrix

At minimum cover:
- Armenia and neighboring markets: Georgia, Azerbaijan, Turkey, Iran (only where lawful/operationally supportable).
- EU/EEA and UK.
- United States and Canada.
- India.
- Asia-Pacific examples: Japan, South Korea, Singapore, Australia.
- Gulf states and wider Middle East.
- Representative Latin American and African countries.

For each channel/provider report supported destinations, exclusions, mobile/landline/VoIP support, operator caveats, local-number availability, caller-ID behavior, direct vs reseller routing, regulatory prerequisites and sender/caller registration requirements. Do not infer worldwide support from marketing claims like “200+ countries”; use exact coverage tables.

## 5. Provider and aggregator audit

Research at least these providers, plus credible regional providers and flash-call specialists:
Twilio, Vonage, Sinch, Infobip, Bird (formerly MessageBird), Telnyx, Plivo, Clickatell, Route Mobile, Telesign, CM.com.

For each capture:
- Product and exact mode (SMS, voice OTP, flash call, Verify API).
- Official pricing and coverage URLs; access date and pricing currency.
- Armenia rates/coverage where available and representative global country rates.
- Billing unit: request, successful verification, message, call minute or destination.
- Number rental, setup, platform, carrier, regulatory, tax, FX, minimum-spend and monthly fees.
- Exact free allowance, trial credit, expiry, card/KYC requirements, country limits and production restrictions.
- Whether trial covers carrier termination or only platform fees.
- Rate limits, throughput, SLA, support, fraud controls and destination permissions.
- DPA, data region, subprocessors, retention and security certifications where documented.
- Vendor lock-in and migration complexity.

Official pricing calculators, documentation and coverage tables are primary evidence. Independent/community reports are secondary and must be labelled. Never present undated or old pricing as current.

## 6. Genuine free alternatives

Investigate ongoing free monthly volume, free inbound verification, user-initiated inbound-call flows, reverse missed-call flows, and open-source/self-hosted PBX/SIP.

For each explain who pays PSTN/SIP termination, number rental, trunking and international routing. Self-hosting is not free if phone numbers or outbound minutes cost money. User-initiated inbound calls may shift cost to the user and create roaming/UX/fairness issues. Reject trial abuse, consumer SIM circumvention, caller-ID spoofing and violations of telecom/provider terms.

## 7. Security and abuse threat model

Model brute force; spoofed/rewritten CLI; number-pool collisions; SIM swap and port-out; forwarding/shared phones; call bombing; SMS pumping; toll fraud; premium destinations; enumeration; replay/races; denial of service; unexpected international bills; compromised provider credentials and routing failure.

Recommend challenge IDs, server-side state, short expiry, attempt limits, per-account/number/IP/device/country velocity controls, country allow/deny lists, hard spend caps, provider destination controls, signed webhook validation, replay protection, idempotency, safe audit logging and recovery step-up. Fallback must not silently lower recovery assurance.

## 8. Cost model

Model 1,000 / 10,000 / 100,000 / 1,000,000 monthly verification attempts. State the assumed country mix and success rates. Separate initiated attempts, delivered calls/messages, successful verifications, retries, fraud and fallbacks. Separate platform fees, carrier fees, number rental and fixed costs. Show monthly spend, cost per successful verification, weighted global average, country outliers, break-even points and sensitivity to delivery, retries, fraud and country mix.

Do not invent rates. Mark unavailable data explicitly. Estimates must show methodology and assumptions.

## 9. Required deliverables

Create `development/reports/BETA-2.0-PHONE-VERIFICATION-CHANNEL-AUDIT.md` containing:
1. Executive recommendation and go/no-go on last-six-digits flash calls.
2. Exact flash-call flow and limitations.
3. International country/channel coverage matrix.
4. Provider comparison with official links, prices, free-tier classification, restrictions and evidence date.
5. Cost scenarios for all four volume tiers.
6. Security, privacy, regulatory threat model and mitigations.
7. Recommended primary/fallback channel strategy.
8. Provider-neutral abstraction proposal.
9. Open questions requiring owner/legal approval.
10. Source register with direct links, publication/update dates and access date.
11. Confidence levels and evidence gaps.

Add a concise evidence-backed findings summary to Identity issue #151. Propose an implementation issue only after product-owner approval.

## 10. Provider abstraction (evaluate, do not implement)

Evaluate a provider-neutral contract such as:
- startVerification(destinationE164, channel, challengeContext)
- checkVerification(verificationId, userInput)
- cancelVerification(verificationId)
- getCapabilities(destinationCountry, channel)

Expose delivery status, normalized errors, cost/route metadata, attempt IDs and expiry without leaking provider secrets. Do not assume every provider supports every channel or callback.

## 11. Hard constraints

- Research only. No production code, schema, migrations, live phone calls, paid signup, paid traffic or Beta 1.0 changes.
- Never use personal phone numbers or real user data.
- Never claim “free” without verifying who pays carrier origination/termination.
- Do not recommend spoofing, trial abuse, SIM-bank workarounds or telecom-policy circumvention.
- International coverage is first-class; Armenia must not be the only or assumed default market.
- Compare total delivered/successful verification cost, not headline message price.
- Cite every material pricing, coverage, free-tier and compliance claim with official evidence and access date.

## 12. Definition of done

- All report sections are present and sourced.
- At least five global providers and credible flash-call specialists are compared, or evidence explains why fewer qualify.
- Free tier vs trial vs sandbox is unambiguous.
- Armenia and multiple global regions are covered.
- Last-six-digits receives an explicit security and international-carrier verdict.
- No implementation or production behavior changes.
- Issue #151 receives a concise findings addendum and the work is ready for owner review.
