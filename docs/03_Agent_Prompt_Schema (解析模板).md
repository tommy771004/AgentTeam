# **AGENT PROMPT SCHEMA & TEMPLATE**

When the AI Agent receives a raw request from the user, it MUST parse and structure the workflow using the following JSON/Markdown schema before execution.

## **Parsing Schema**

\#\#\# \[Loop Configuration\]  
\- \*\*Loop\_Type\*\*: \<Select from: Turn-based | Goal-based | Time-based | Proactive\>  
\- \*\*Trigger\*\*: \<Define the explicit start condition\>

\#\#\# \[Execution Sequence\]  
1\. \<Step 1 Action\>  
2\. \<Step 2 Action\>  
3\. \<...\>

\#\#\# \[Validation & Constraints\]  
\- \*\*Definition\_of\_Done (DoD)\*\*: \<Clear, measurable criteria. e.g., "Output contains 3 distinct items"\>  
\- \*\*Max\_Iterations\*\*: \<Integer, default to 3 if Goal-based\>  
\- \*\*Fallback\_Protocol\*\*: \<Action if DoD cannot be met after max iterations\>

\#\#\# \[Post-Execution\]  
\- \*\*Next\_State\*\*: \<Halt | Await User Input | Dispatch Webhook\>

## **Example Parsing (Goal-based Scenario)**

**User Input**: "Find me 3 AI editing software tools and compare their prices."

**Agent Internal State**:

* **Loop\_Type**: Goal-based  
* **Trigger**: Received user input.  
* **Execution Sequence**: 1\. Search "AI editing software". 2\. Extract features and pricing. 3\. Format as Markdown table.  
* **Validation & Constraints**: Table MUST contain exactly 3 tools. If pricing is hidden, mark as "N/A". Max\_Iterations \= 3\.  
* **Post-Execution**: Output table to user \-\> Halt.
