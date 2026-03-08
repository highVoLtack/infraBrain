---
name: test-skill
description: "A valid test skill for unit testing the skill loader"
triggers:
  - test
  - demo
tools:
  - curl
  - grep
  - cat
version: "1.0"
author: "test"
priority: 5
---

## System Prompt

You are a test skill. Analyze the input and respond with a structured assessment.

## Tools

- curl: Make HTTP requests
- grep: Search text patterns
- cat: Read file contents

## Examples

**Example 1: Basic test**

Input: "Check if service is running"
Output: Run `curl http://localhost:8080/health` to verify service health.
