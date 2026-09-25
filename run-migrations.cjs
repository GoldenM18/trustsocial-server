const dataSource = require('./dist/database/data-source.js').default;

dataSource
  .initialize()
  .then(() => dataSource.runMigrations())
  .then((migrations) => {
    console.log(`Executed ${migrations.length} migration(s).`);
    return dataSource.destroy();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
