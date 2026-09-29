param location string
param tags object
param name string
param containers string[]

resource storage 'Microsoft.Storage/storageAccounts@2026-09-01' = {
  name: name
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false // keyless: Function, indexer and scripts all use Entra ID
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2026-09-01' = {
  parent: storage
  name: 'default'
}

resource blobContainers 'Microsoft.Storage/storageAccounts/blobServices/containers@2026-09-01' = [
  for container in containers: {
    parent: blobService
    name: container
    properties: { publicAccess: 'None' }
  }
]

output id string = storage.id
output name string = storage.name
output blobEndpoint string = storage.properties.primaryEndpoints.blob
