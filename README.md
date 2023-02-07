# Google Docs Driver

This [driver](https://membrane.io) lets you interact with Google Docs through your Membrane graph.

To setup this driver follow steps:

1: Add docs scopes in [Edit application record](https://console.cloud.google.com/apis/credentials/consent/edit)

2: Enable Google Docs API on [Library](https://console.cloud.google.com/apis/library)

3: Add callback URL to Authorized redirect URIs on [OAuth consent screen](https://console.cloud.google.com/apis/credentials/oauthclient/)

4: Invoke the `:configure` Action with the Client ID and Client Secret.

5: Open the Endpoint URL and follow steps.

# Schema

### Types
```javascript
<Root>
    - Fields
        documents -> Ref <DocumentCollection>
        status -> String
    - Actions
        configure -> Void
        checkStatus -> Boolean
<DocumentColection>
    - Fields
        one(id) -> Ref <Document>
    - Actions
        create(body, title) -> Ref <Document>
<Document>
    - Fields
        body -> String
        markdown -> String
        revisionId -> String
    - Actions
        batchUpdate(requests) -> String
        replaceAllText(text, replaceText, matchCase) -> Int
        insertText(text, segmentId, index) -> Void
        insertBullet(text, index, bulletPreset) -> Void
        InsertLink(text, index, url) -> Void