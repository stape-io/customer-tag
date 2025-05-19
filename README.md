# Customer.io Tag for Google Tag Manager Server-Side

The **Customer.io Tag for GTM Server-Side** allows you to send events, page views, screen views, user profile updates, and group assignments directly to Customer.io using their Data Pipelines API. This tag supports rich event and user data and handling anonymous IDs automatically.

## How to Use

1. Add the **Customer.io Tag** to your Server GTM container from the Template Gallery or importing the `template.tpl` file.
2. Enter your **API Key** (found in Customer.io Workspace > Data & Integrations > Customer.io API > Settings).
3. Select your **Account Region** (EU or US) to route requests to the correct endpoint.
4. Choose the **Action Type**:
   - **Track Event** (custom or semantic events)
   - **Track Page View**
   - **Track Screen View**
   - **Identify User** (update user profile traits)
   - **Add User to Group**
5. Provide **User ID** or **Anonymous ID** (anonymous IDs can be generated and stored automatically via cookie on web).
6. Configure relevant **event, user, group, page, or screen properties** depending on your chosen action.
7. Optionally set **Consent Settings** to only send data when marketing consent is granted.
8. (Optional) Enable **logging** to Console and/or BigQuery for debugging and monitoring.

## Supported Event Name Mapping

- For **Track Event**, you can:
  - Use **Standard** semantic event names from [Customer.io's documented list](https://docs.customer.io/api/cdp/#section/Semantic-events) (only for *Ecommerce* and *Mobile App* are listed).
  - **Inherit** event names from client events (with partial mapping from GA4).
  - Define **Custom** event names manually.

## Required Fields

- **API Key** — your Customer.io API authentication token.
- **User ID** or **Anonymous ID** — one of these must be provided to identify the user.
- **Event Name** — required when tracking events.
- **Group ID** — required when adding a user to a group.

## Features

- **Anonymous ID cookie management**: Automatically reads or generates the `ajs_anonymous_id` cookie if no user ID is present and option enabled.
- **Context enrichment**: Automatically adds `campaign`, `page`, `app`, `device`, `network`, `OS`, `IP`, `user agent`, and `locale` data.
- **User and group traits**: Merge predefined and custom traits when identifying users or adding them to groups.
- **Page and screen view properties**: Customize and extend page or screen metadata.
- **IP redaction**: Optionally redact visitor IP addresses for privacy.
- **Optimistic scenario**: Option to fire success callback immediately without waiting for API response.
- **Detailed logging**: Logs request and response details to console and BigQuery for troubleshooting.

## Open Source

The **Customer.io Tag for GTM Server-Side** is developed and maintained by the [Stape Team](https://stape.io/) under the Apache 2.0 license.
