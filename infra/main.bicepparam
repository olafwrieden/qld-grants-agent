using 'main.bicep'

param environmentName = 'qldgrants'
param location = 'australiaeast'

// Supplied at deploy time: az deployment group create ... -p qldApiKey=<key> principalId=<your-object-id>
param qldApiKey = readEnvironmentVariable('QLD_API_KEY', '')
param principalId = readEnvironmentVariable('AZURE_PRINCIPAL_ID', '')
