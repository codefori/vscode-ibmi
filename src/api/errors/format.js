function formatName(input) {
  let pieces = input.split(`/`);
  let path = pieces[1].substr(pieces[1], pieces[1].length-1).split(`(`);

  return [pieces[0], path[0], path[1]].join(`/`)
}

function formatIFS(path) {
  const pieces = path.split(`/`);
  const newPath = pieces.filter(x => x !== `.`);

  return newPath.join(`/`);
}

module.exports = {
  formatName,
  formatIFS
}