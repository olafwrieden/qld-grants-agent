param location string
param tags object
param accountName string
param projectName string
param embeddingModel object
param chatModel object
param searchServiceId string
param searchEndpoint string
param knowledgeBaseName string
param searchApiVersion string
param appInsightsId string
@description('Not a secret for Entra ingestion, but required connection metadata.')
param appInsightsConnectionString string

// Microsoft Foundry resource (AIServices) with project management enabled.
resource account 'Microsoft.CognitiveServices/accounts@2026-09-15-preview' = {
  name: accountName
  location: location
  tags: tags
  kind: 'AIServices'
  sku: { name: 'S0' }
  identity: { type: 'SystemAssigned' }
  properties: {
    customSubDomainName: accountName
    allowProjectManagement: true
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: true
  }
}

resource project 'Microsoft.CognitiveServices/accounts/projects@2026-09-15-preview' = {
  parent: account
  name: projectName
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    displayName: 'QLD Grants'
    description: 'Queensland Government grants discovery (FoundryIQ).'
  }
}

resource embedding 'Microsoft.CognitiveServices/accounts/deployments@2026-09-15-preview' = {
  parent: account
  name: embeddingModel.name
  dependsOn: [project]
  sku: {
    name: embeddingModel.sku
    capacity: embeddingModel.capacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: embeddingModel.name
      version: embeddingModel.version
    }
    versionUpgradeOption: 'OnceNewDefaultVersionAvailable'
  }
}

// Child writes on the same account (project, deployments) must be sequential.
resource chat 'Microsoft.CognitiveServices/accounts/deployments@2026-09-15-preview' = {
  parent: account
  name: chatModel.name
  dependsOn: [embedding]
  sku: {
    name: chatModel.sku
    capacity: chatModel.capacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: chatModel.name
      version: chatModel.version
    }
    versionUpgradeOption: 'OnceNewDefaultVersionAvailable'
  }
}

// Lets the Foundry project (agents / FoundryIQ) use the search service with Entra ID.
resource searchConnection 'Microsoft.CognitiveServices/accounts/projects/connections@2026-09-15-preview' = {
  parent: project
  name: 'grants-search'
  dependsOn: [chat]
  properties: {
    category: 'CognitiveSearch'
    target: searchEndpoint
    authType: 'AAD'
    isSharedToAll: true
    metadata: {
      ApiType: 'Azure'
      ResourceId: searchServiceId
      location: location
    }
  }
}

// RemoteTool connection used by the prompt agent's MCP tool to call the FoundryIQ knowledge base
// (knowledge_base_retrieve) with the project's managed identity.
resource kbMcpConnection 'Microsoft.CognitiveServices/accounts/projects/connections@2026-09-15-preview' = {
  parent: project
  name: '${knowledgeBaseName}-mcp'
  dependsOn: [searchConnection]
  properties: {
    category: 'RemoteTool'
    target: '${searchEndpoint}/knowledgebases/${knowledgeBaseName}/mcp?api-version=${searchApiVersion}'
    authType: 'ProjectManagedIdentity'
    audience: 'https://search.azure.com/'
    isSharedToAll: true
    metadata: {
      ApiType: 'Azure'
    }
  }
}

// Agent tracing/monitoring: Foundry Agent Service sends OpenTelemetry traces to this Application Insights
// (portal: Agents > Traces / Monitor). Keyless: ingestion uses the project managed identity, which gets
// Monitoring Metrics Publisher on the component (roles.bicep). Only one AppInsights connection per project.
resource appInsightsConnection 'Microsoft.CognitiveServices/accounts/projects/connections@2026-09-15-preview' = {
  parent: project
  name: 'appinsights'
  dependsOn: [kbMcpConnection]
  properties: {
    category: 'AppInsights'
    target: appInsightsId
    authType: 'ProjectManagedIdentity'
    isSharedToAll: true
    metadata: {
      ApiType: 'Azure'
      ResourceId: appInsightsId
      ApplicationInsightsConnectionString: appInsightsConnectionString
    }
  }
}

output accountName string = account.name
output projectName string = project.name
output projectEndpoint string = 'https://${account.properties.customSubDomainName}.services.ai.azure.com/api/projects/${project.name}'
output kbMcpConnectionName string = kbMcpConnection.name
output projectPrincipalId string = project.identity.principalId
output openAiEndpoint string = 'https://${account.properties.customSubDomainName}.openai.azure.com'
output embeddingDeployment string = embedding.name
output chatDeployment string = chat.name
