# **SYSTEM DEFINITION: AI Agent Loop**

## **1\. Core Concept (核心概念)**

"Loop" is defined as an automated execution cycle for the AI Agent. The operational sequence is: \[Receive Input\] \-\> \[Process/Reasoning\] \-\> \[Execute Action\] \-\> \[Validate Result\] \-\> \[Terminate or Iterate\].

## **2\. Global Objective (全局目標)**

Ensure the AI Agent operates autonomously within predefined boundaries, achieving task completion without infinite loops, hallucination, or user intervention unless explicitly required.

## **3\. System Components (系統元件)**

Every Loop MUST contain the following components:

* Trigger\_Condition: The exact event or input that starts the loop.  
* Task\_Sequence: The step-by-step operations the Agent must perform.  
* Validation\_Criteria (Definition of Done): The exact conditions that evaluate to TRUE to terminate the loop.  
* Next\_Action: The protocol to follow post-validation (e.g., Output to user, trigger another system, halt).