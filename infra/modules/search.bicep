param location string
param tags object
param name string

@allowed(['free', 'standard'])
param semanticSearch string

@allowed(['free', 'standard'])
param knowledgeRetrieval string

// Serverless (preview) tier: consumption-based, no replicas/partitions to size.
resource search 'Microsoft.Search/searchServices@2026-09-01-preview' = {
  name: name
  location: location
  tags: tags
  sku: { name: 'serverless' }
  identity: { type: 'SystemAssigned' }
  properties: {
    semanticSearch: semanticSearch
    knowledgeRetrieval: knowledgeRetrieval
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: false
    authOptions: {
      aadOrApiKey: { aadAuthFailureMode: 'http401WithBearerChallenge' }
    }
  }
}

output id string = search.id
output name string = search.name
output endpoint string = 'https://${search.name}.search.windows.net'
output principalId string = search.identity.principalId
