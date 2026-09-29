using 'main.bicep'

param environmentName = 'qldgrants'
param location = 'australiaeast'

// Supplied at deploy time: az deployment group create ... -p qldApiKey=<key> principalId=<your-object-id>
param qldApiKey = readEnvironmentVariable('QLD_API_KEY', '')
param principalId = readEnvironmentVariable('AZURE_PRINCIPAL_ID', '')

// Opt out of an org policy that forces storage public network access off (set STORAGE_POLICY_OPT_OUT=true).
param storageExtraTags = readEnvironmentVariable('STORAGE_POLICY_OPT_OUT', 'false') == 'true' ? { SecurityControl: 'Ignore' } : {}
