'use strict';

const config  = require('./config.json');
const functions = require('firebase-functions');
const rp = require('request-promise');
const crypto = require('crypto');
const secureCompare = require('secure-compare');

exports.githubWebhook = functions.https.onRequest((req, res) => {
  const signature = req.headers['x-hub-signature'];
  const cipher = 'sha1';
  const hmac = crypto.createHmac(cipher, functions.config().github.secret)
    .update(JSON.stringify(req.body, null, 0))
    .digest('hex');
  const expectedSignature = `${cipher}=${hmac}`;
  let mentions = '';

  if (!secureCompare(signature, expectedSignature)) {
    console.error('x-hub-signature', signature, 'did not match', expectedSignature);
    return res.status(403).send('Your x-hub-signature\'s bad and you should feel bad!');
  }
  
  switch (req.headers["x-github-event"]) {
    case 'issue_comment':
    case 'pull_request_review_comment':
      mentions += extractMentionNamesFromBody(req.body.comment.body);
      break;
    case 'pull_request_review':
      mentions += extractMentionNamesFromBody(req.body.review.body);
      break;
    case 'pull_request':
      if (req.body.pull_request.state === 'open') {
        mentions += extractMentionNamesFromBody(req.body.pull_request.body);
        mentions += extractMentionNamesFromAssignees(req.body.pull_request.assignees);
      }
      break;
    case 'issues':
      if (req.body.issue.state === 'open') {
        mentions += extractMentionNamesFromBody(req.body.issue.body);
        mentions += extractMentionNamesFromAssignees(req.body.issue.assignees);
      }
      break;
  }

  if (!mentions) return res.end();
  const channel = config.channel_map[req.body.repository.name] || "#notification_test";
  return postToSlack(mentions, channel).then(() => {
    res.end();
  }).catch(error => {
    console.error(error);
    res.status(500).send('Something went wrong while posting the message to Slack.');
  });
});

function postToSlack(mentions, channel) {
  return rp({
    method: 'POST',
    uri: functions.config().slack.webhook_url,
    body: {
      text: mentions,
      link_names: 1,
      channel: channel
    },
    json: true
  });
}

function extractMentionNamesFromBody(body) {
  let result = '';
  let mentions = body.match(/@[a-zA-Z0-9_\-]+/g);
  if (mentions) {
    mentions.forEach(function(mention) {
      result += convertMentionName(mention) + "\n";
    });
  }
  return result;
};

function extractMentionNamesFromAssignees(assignees) {
  if (!assignees || assignees.length == 0) return '';
  let result = '';
  assignees.forEach(function(assignee) {
    result += convertMentionName("@" + assignee.login) + "\n";
  })
  return result;
};

function convertMentionName(name) {
  return config.account_map[name] || name;
}
