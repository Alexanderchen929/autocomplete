import { danger, markdown, schedule } from "danger";
import * as fs from "fs";
import {
  createSourceFile,
  forEachChild,
  isFunctionExpression,
  isPropertyAssignment,
  isStringLiteral,
  Node,
  PropertyAssignment,
  ScriptTarget,
  SourceFile,
  TransformerFactory,
  visitEachChild,
  visitNode,
} from "typescript";

export const specTransformer: TransformerFactory<SourceFile> = (context) => {
  return (sourceFile) => {
    const visitor = (node: Node) => {
      if (isPropertyAssignment(node)) {
        const typedNode = node as PropertyAssignment;
        if (typedNode.name.getText() === "script") {
          console.log(typedNode.initializer.getText());
        }
      }
      return visitEachChild(node, visitor, context);
    };
    return visitNode(sourceFile, visitor);
  };
};

const getFileContent = (fileContent: Node) => {
  const scripts: string[] = [];
  const functions: [string, string][] = [];
  const pairs: [string, [string, string]][] = [];

  let isLastScript = false;
  let lastScript: string;

  const visitor = (node: Node) => {
    // PropertyAssignment === Key-Value pair in object
    if (isPropertyAssignment(node)) {
      const propertyKey: string = (node.name as any).escapedText;
      // Find all scripts
      if (propertyKey === "script" && isStringLiteral(node.initializer)) {
        scripts.push(node.initializer.text);
        lastScript = node.initializer.text;
        isLastScript = true;
      }

      // Find all functions
      if (isFunctionExpression(node.initializer)) {
        if (isLastScript) {
          scripts.pop();
          pairs.push([
            lastScript,
            [
              propertyKey,
              fileContent
                .getFullText()
                .slice(node.initializer.pos, node.initializer.end),
            ],
          ]);
        } else {
          functions.push([
            propertyKey,
            fileContent
              .getFullText()
              .slice(node.initializer.pos, node.initializer.end),
          ]);
        }
      }
    }
    forEachChild(node, visitor);
  };

  visitor(fileContent);

  return {
    scripts,
    functions,
    pairs,
  };
};

schedule(async () => {
  const { owner, repo, number } = danger.github.thisPR;

  const { data: comments } = await danger.github.api.issues.listComments({
    issue_number: number,
    repo,
    owner,
  });

  const reviewCommentRef = comments.find((comment) =>
    comment.body.includes("id: review-bot")
  );

  // Get all changed and added files
  const updatedFiles = danger.git.modified_files
    .concat(danger.git.created_files)
    .filter((file) => file.includes("dev/"));

  let message = "<!-- id: review-bot --> \n";
  let comment = "";
  if (updatedFiles.length > 0) {
    updatedFiles.forEach((fileName) => {
      const content = fs.readFileSync(fileName, { encoding: "utf-8" });
      const sourceFile = createSourceFile("temp", content, ScriptTarget.Latest);
      const fileContent = getFileContent(sourceFile);

      message += `## ${fileName}:
### Info:
${fileContent.pairs
  .map(
    ([scriptName, [key, value]]) => `**Script:**
\`${scriptName}\`
**${key}(function):**
\`\`\`typescript
${value}
\`\`\`
`
  )
  .join("\n")}
${
  fileContent.scripts.length > 0
    ? `### Single Scripts:
${fileContent.scripts.map((s) => `- \`${s}\``).join("\n")}`
    : ""
}
${
  fileContent.functions.length > 0
    ? `### Single Functions:
${fileContent.functions
  .map(
    ([key, value]) => `**${key}:**
\`\`\`typescript
${value}
\`\`\`
`
  )
  .join("\n")}`
    : ""
}
`;
    });
    comment = `# Overview
${message}`;
  } else {
    comment = `# No files changed ☑️ ${message}`;
  }
  if (reviewCommentRef != null) {
    await danger.github.api.issues.updateComment({
      body: comment,
      comment_id: reviewCommentRef.id,
      owner,
      repo,
    });
  } else {
    await danger.github.api.issues.createComment({
      body: comment,
      issue_number: number,
      owner,
      repo,
    });
  }
});
