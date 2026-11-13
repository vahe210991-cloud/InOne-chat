# Product vision — Propo, InOne Business and InOne

**Version:** 0.1  
**Status:** Product direction based on owner statements; unresolved details are marked.

## 1. The platform in one sentence

**Propo helps people discover and buy products in Armenia; InOne Business gives the organizations selling on Propo the internal workplace to operate their stores; InOne gives people their personal communication and social space.**

The three products are related, but they do not have the same purpose.

## 2. Propo — marketplace and classifieds

Propo is the marketplace and classifieds project in Armenia.

Its primary external audience:
- buyers looking for products and offers;
- sellers and stores publishing products;
- store employees who perform seller-side work.

Propo is the marketplace-facing product and owns the marketplace customer experience and marketplace business records. The exact Propo domain boundaries and existing API contracts must be confirmed with the Propo project; this document does not invent its implementation.

## 3. InOne Business — the organization's operating workspace

InOne Business is the logical professional continuation of Propo. It is the **backstage and back office of the marketplace** for seller organizations.

It is not merely a messenger and it is not a second marketplace catalogue. It is where a store's owner and authorized employees coordinate and manage the work that results in marketplace activity.

### Example operating scenario

A store team may:
1. Discuss whether a product should be launched.
2. Open a dedicated discussion thread for product selection, research and approval.
3. Discuss which banner or campaign creative should be published in another thread.
4. Coordinate sales and customer-service activity in separate discussions.
5. Receive buyer messages and marketplace notifications.
6. See alerts about purchases, ratings and reviews.
7. Request calculations, summaries and answers from business tools or an assistant.
8. Review store sales analytics and performance.
9. Assign work to employees according to their roles and permissions.
10. Move between Propo and InOne Business without repeatedly reconstructing the seller's context.

### InOne Business capabilities

Owner-stated capabilities and direction:
- organization/store workspace;
- employees, roles and permissions;
- internal chats and threaded discussions;
- product and campaign planning discussions;
- buyer messages;
- purchase/order notifications;
- rating and review notifications;
- sales reporting and analytics;
- business calculations and answers;
- Kanban;
- CRM;
- Leads;
- Deals;
- Wallet;
- Flags;
- publications, news feed, stories and statuses for organization-related presence;
- owner-controlled organization profile editing;
- lightweight navigation between Propo and InOne Business;
- integration with Propo Seller Account.

The exact meaning, workflow and data source of Wallet, Flags, CRM, Leads and Deals must be defined in domain specifications. The names alone are not sufficient API or accounting requirements.

### Product principle

InOne Business must let a seller organization coordinate its people and operations around Propo without making Propo's marketplace database directly accessible to the mobile application.

## 4. InOne — personal and social space

InOne is the personal product for an individual.

Its purpose is communication, identity and social participation outside the operational back office of a seller organization.

Owner-stated direction:
- personal and group chats;
- groups;
- communities;
- channels;
- news feed;
- publications and personal profile feed;
- avatar;
- cover image;
- "About me";
- stories;
- statuses;
- other personal social and communication features.

A person's InOne profile is not the same thing as their employee membership or organization profile in InOne Business.

## 5. Relationship between the three products

- Propo is the marketplace and classifieds surface.
- InOne Business is the organization-facing operating environment connected to Propo Seller Account.
- InOne is the person's independent personal/social environment.
- A person may be an employee or owner in one or more organizations, subject to the identity and membership model still to be approved.
- Organization content and personal content must have explicit ownership and audience rules; they must not be mixed accidentally.
- A person may have access to InOne and InOne Business, but the products must keep their own navigation, purpose and authorization context.

## 6. Product outcomes

### For a seller organization
- faster coordination;
- clear ownership of work;
- fewer missed buyer and marketplace events;
- better visibility of store sales and operational performance;
- controlled access based on employee responsibilities;
- less switching friction between marketplace and back office.

### For an individual
- one place for personal conversations and communities;
- control over personal profile and publications;
- social participation independent of their employer.

### For the platform
- clear product boundaries;
- reliable marketplace integration;
- auditable access to organization data;
- reusable identity and communication capabilities where approved;
- the ability to add business modules without turning InOne into one overloaded application.

## 7. Non-goals unless separately approved

- Replacing Propo's marketplace customer app with InOne Business.
- Duplicating Propo product, order, payment or seller records as an independent source of truth.
- Making InOne a mandatory dependency for Propo marketplace availability.
- Treating an employee as an organization owner by default.
- Assuming all social content is public or all organization content is private.
- Assuming that all named business modules are already fully specified.
