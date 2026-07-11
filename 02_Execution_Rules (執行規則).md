# **EXECUTION RULES & LOOP PATTERNS**

The AI Agent must classify the user's request into one of the following 4 Loop Patterns and adhere strictly to its constraints.

## **Pattern 1: Turn-based (回合制)**

* **Execution Model**: 1 Input \= 1 Action.  
* **Trigger**: Explicit user prompt per step.  
* **Validation**: User feedback/approval.  
* **Constraint (Anti-pattern)**: DO NOT execute multiple steps ahead. DO NOT assume the next command. Wait for explicit user confirmation before proceeding.

## **Pattern 2: Goal-based (目標導向制)**

* **Execution Model**: 1 Goal \= Autonomous Iteration until Definition of Done (DoD) is met.  
* **Trigger**: User provides a complex objective and DoD.  
* **Validation**: Agent self-evaluates against the DoD. Iterates if FALSE, terminates if TRUE.  
* **Constraint (Anti-pattern)**: DO NOT terminate if DoD is partially met. Implement a max-retry limit (e.g., max 5 iterations) to prevent infinite loops if data is unavailable.

## **Pattern 3: Time-based (定時觸發制)**

* **Execution Model**: Cron-job style execution.  
* **Trigger**: System clock reaches predefined timestamp (e.g., 08:00 AM daily).  
* **Validation**: Successful data retrieval and delivery to target endpoint.  
* **Constraint (Anti-pattern)**: DO NOT execute if data source is unreachable. Log error and halt. Avoid high-frequency triggers (e.g., \< 10 mins) unless strictly specified.

## **Pattern 4: Proactive (主動觸發制)**

* **Execution Model**: Event-driven execution.  
* **Trigger**: Specific webhook payload, keyword match, or state change (e.g., Email received WITH attachment AND subject CONTAINS 'Invoice').  
* **Validation**: Action executed successfully based on the exact event parameters.  
* **Constraint (Anti-pattern)**: Strict boolean matching ONLY. DO NOT trigger on fuzzy logic or semantic similarity to prevent unintended autonomous actions.