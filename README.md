# SolAuditEstimator: Audit Time Estimation Algorithm

## **Input**:

- Smart contract code

## **Output**:

- Estimated time required for the audit (in hours)

## **Steps**:

### 1. **Analyze the Size of the Contract**:

- Count the lines of code (LOC).
  - `small_contract` threshold: <= 200 LOC
  - `medium_contract` threshold: 201-1000 LOC
  - `large_contract` threshold: >1000 LOC

### 2. **Determine Complexity**:

- Count the number of functions.
- Identify and count external calls.
- Detect if the contract interacts with other contracts (e.g., using interface or `import`).
- Check for advanced Solidity features, such as `assembly` blocks.
- Determine if the contract is upgradeable.

### 3. **Estimate Base Audit Time**:

- For `small_contract`: 5 hours
- For `medium_contract`: 20 hours
- For `large_contract`: 50 hours

### 4. **Adjust for Complexity**:

- Add 0.5 hours for every function after the first 10.
- Add 2 hours for every external call detected.
- If other contracts are interacted with, add 5 hours.
- For every detected advanced Solidity feature, add 3 hours.
- If the contract is upgradeable, adjust accordingly (considering factors such as proxy patterns, data migration, and administrative functions).

### 5. **Compile and Report**:

- Sum the base audit time and adjustments to get the total estimated audit time.

## **Return**:

- Return the total estimated audit time.

## **Usage**:

```shell
node contract_estimator.js <full path to contract code> [--optimizer-runs <number of optimizer runs>]`
```
