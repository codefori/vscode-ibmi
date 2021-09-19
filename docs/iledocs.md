
# ILEDocs

Code for IBM i follows the ILEDocs standard for writing documentation for the ILE languages. This document mainly covers how to use it with RPGLE free-format.

Code for IBM i will make use of the documentation block to improve content assist and hover support.

## Standard format

### Layout

The documentation block format is as follows.

1. Start with `///` - this starts the documentation block for the procedure
2. The first comment is the **title**
3. The next comments define the **description**
4. After the description, tags can be used.
5. End the block with `///` again.

```rpgle
///
// TITLE
// DESCRIPTION!
// Description can be multiline
// @tag data
// @tag data
///
Dcl-Proc ...
```

### Can be used on

Documentation blocks can be used on pretty much any RPG functionality:

* Constants
* Variables/structs
* Procedures
* Subroutines

### Available tags

All tags start with `@`. Tags in bold are most commonly used.

* **param** - multi line - Description of the parameter
* **return** - multi line - Description of the return value
* **deprecated** - multi line - Description why a program or procedure shouldn't be used and stating any replacement.
* author - single line - Author of the source code
* date - single line - Date (any format)
* brief (title) - single line - Must be the first tag in an ILEDocs block. The tag can also be ignored, see example above.
* link - multi line - @link http://url Description
* rev (revision) - multi line - `@rev date author`, following lines are the description of the revision
* project - single line - Name of the project (so that the module can be placed under the corresponding project in the UI)
* warning - multi line
* info - multi line
* throws - multi line - Id and description of an escape message the user of the program/procedure can expect in certain cases
* version - single line - version of the module

## Basics

Basic rules:

* All documentation is optional, but the better documentation you provide, the better the content assist and generated documentation is.
* For each parameter in a procedure, there should be as many `@param` tags which provide a short description of what the parameter is. 
* The first line of the documentation block is always the title.

```rpgle
///
// Transform to lowercase
// This procedure will take a string and transform it to lowercase
//
// @param The string
// @return The lowercase value
///
Dcl-Proc ToLower Export;
  Dcl-Pi *N Char(20);
    stringIn Char(20);
  End-pi;

  return STRLOWER(stringIn);
End-Proc;
```