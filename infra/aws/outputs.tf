output "instance_id" {
  description = "ID of the spot instance."
  value       = aws_instance.host.id
}

output "public_ip" {
  description = "Public IPv4 address of the spot instance."
  value       = aws_instance.host.public_ip
}

output "backup_uri" {
  description = "S3 URI of the dump bucket, as the daemon's backup target."
  value       = "s3://${aws_s3_bucket.backups.id}"
}

output "security_group_id" {
  description = "ID of the security group that admits SSH from the admin /32 only."
  value       = aws_security_group.host.id
}
